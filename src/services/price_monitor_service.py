# -*- coding: utf-8 -*-
"""
===================================
价格监控服务
===================================

管理监控组、执行价格检查、发送告警通知
"""

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from src.config import Config, get_config
from src.storage import DatabaseManager, PriceMonitorGroup, PriceMonitorItem, PriceMonitorAlert
from src.notification_sender.feishu_sender import FeishuSender
from data_provider.base import DataFetcherManager
from data_provider.realtime_types import UnifiedRealtimeQuote

logger = logging.getLogger(__name__)


class MonitorItemSnapshot:
    """包含实时价格的监控项状态快照"""

    def __init__(
        self,
        id: int,
        code: str,
        name: str,
        ideal_buy: Optional[float],
        secondary_buy: Optional[float],
        stop_loss: Optional[float],
        take_profit: Optional[float],
        current_price: Optional[float] = None,
        change_pct: Optional[float] = None,
        triggered_types: List[str] = None,
        is_active: bool = True,
        last_check_time: Optional[datetime] = None,
    ):
        self.id = id
        self.code = code
        self.name = name
        self.ideal_buy = ideal_buy
        self.secondary_buy = secondary_buy
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.current_price = current_price
        self.change_pct = change_pct
        self.triggered_types = triggered_types or []
        self.is_active = is_active
        self.last_check_time = last_check_time

        # 计算距离点位百分比
        self.distance_to_ideal = self._calc_distance(current_price, ideal_buy, inverse=True)
        self.distance_to_stop = self._calc_distance(current_price, stop_loss, inverse=True)
        self.distance_to_target = self._calc_distance(current_price, take_profit, inverse=False)

    def _calc_distance(
        self, current: Optional[float], target: Optional[float], inverse: bool = False
    ) -> Optional[float]:
        """计算当前价格到目标点位的距离百分比"""
        if current is None or target is None or target <= 0:
            return None
        if current <= 0:
            return None

        distance = (current - target) / target * 100
        if inverse:
            # 对于买入点/止损点，越接近或低于目标，距离越小（负值表示已触发）
            return distance
        else:
            # 对于目标点，越接近或高于目标，距离越大
            return distance

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式用于API响应"""
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "idealBuy": self.ideal_buy,
            "secondaryBuy": self.secondary_buy,
            "stopLoss": self.stop_loss,
            "takeProfit": self.take_profit,
            "currentPrice": self.current_price,
            "changePct": self.change_pct,
            "distanceToIdeal": self.distance_to_ideal,
            "distanceToStop": self.distance_to_stop,
            "distanceToTarget": self.distance_to_target,
            "triggeredTypes": self.triggered_types,
            "isActive": self.is_active,
            "lastCheckTime": self.last_check_time.isoformat() if isinstance(self.last_check_time, datetime) else self.last_check_time,
        }


class PriceMonitorService:
    """价格监控服务 - 管理监控组、执行价格检查"""

    def __init__(self, db: DatabaseManager, config: Config):
        self.db = db
        self.config = config
        self.feishu = FeishuSender(config)
        self.data_manager = DataFetcherManager()

    # ========== 监控组管理 ==========

    def ensure_default_group(self, owner_id: Optional[str] = None) -> Optional[int]:
        """
        确保存在默认监控组，如果不存在则从 STOCK_LIST 创建

        Returns:
            默认组ID，如果创建失败返回None
        """
        with self.db.get_session() as session:
            # 检查是否已有默认组
            existing = session.execute(
                select(PriceMonitorGroup).where(
                    and_(
                        PriceMonitorGroup.is_default == True,
                        PriceMonitorGroup.owner_id == owner_id,
                    )
                )
            ).scalar_one_or_none()

            if existing:
                # 同步自选股列表（添加新增的股票）
                self._sync_watchlist_to_group(session, existing.id)
                return existing.id

            # 从 STOCK_LIST 创建默认组
            stock_list = self.config.stock_list if self.config else []
            if not stock_list:
                logger.warning("STOCK_LIST 为空，无法创建默认监控组")
                return None

            try:
                group = PriceMonitorGroup(
                    name="自选股",
                    description="从 STOCK_LIST 环境变量自动创建的默认监控组",
                    is_default=True,
                    owner_id=owner_id,
                )
                session.add(group)
                session.flush()  # 获取group.id

                # 为每只股票获取推荐点位并创建监控项
                for code in stock_list:
                    item = self._create_monitor_item_from_analysis(session, group.id, code)
                    if item:
                        session.add(item)

                session.commit()
                logger.info(f"已创建默认监控组，包含 {len(stock_list)} 只股票")
                return group.id

            except Exception as e:
                session.rollback()
                logger.error(f"创建默认监控组失败: {e}")
                return None

    def sync_watchlist_to_default_group(self, owner_id: Optional[str] = None) -> Dict[str, Any]:
        """
        手动同步自选股到默认监控组

        将当前 STOCK_LIST 中的股票与监控组同步：
        - 新增 STOCK_LIST 中有但监控组中没有的股票
        - 将监控组中有但 STOCK_LIST 中没有的股票标记为禁用

        Returns:
            同步结果统计
        """
        stock_list = self.config.stock_list if self.config else []
        if not stock_list:
            return {"error": "STOCK_LIST 为空"}

        with self.db.get_session() as session:
            # 查找默认组
            group = session.execute(
                select(PriceMonitorGroup).where(
                    and_(
                        PriceMonitorGroup.is_default == True,
                        PriceMonitorGroup.owner_id == owner_id,
                    )
                )
            ).scalar_one_or_none()

            if not group:
                # 没有默认组则创建
                group_id = self.ensure_default_group(owner_id)
                return {"created": True, "group_id": group_id}

            result = self._sync_watchlist_to_group(session, group.id)
            session.commit()
            return result

    def _sync_watchlist_to_group(self, session: Session, group_id: int) -> Dict[str, Any]:
        """
        同步自选股列表到指定监控组（内部方法）

        Returns:
            同步结果统计
        """
        stock_list = self.config.stock_list if self.config else []
        stock_set = set(code.upper() for code in stock_list)

        # 获取当前监控组中的所有股票
        existing_items = session.execute(
            select(PriceMonitorItem).where(PriceMonitorItem.group_id == group_id)
        ).scalars().all()

        existing_codes = {item.code.upper() for item in existing_items}

        # 1. 添加新增的股票
        added = []
        for code in stock_set - existing_codes:
            item = self._create_monitor_item_from_analysis(session, group_id, code)
            if item:
                session.add(item)
                added.append(code)

        # 2. 将不在 STOCK_LIST 中的股票标记为禁用（软删除）
        disabled = []
        for item in existing_items:
            if item.code.upper() not in stock_set and item.is_active:
                item.is_active = False
                disabled.append(item.code)

        # 3. 如果之前被禁用的股票重新出现在 STOCK_LIST 中，重新启用
        re_enabled = []
        for item in existing_items:
            if item.code.upper() in stock_set and not item.is_active:
                item.is_active = True
                re_enabled.append(item.code)

        result = {
            "added": added,
            "disabled": disabled,
            "re_enabled": re_enabled,
            "total": len(stock_set),
        }

        if added or disabled or re_enabled:
            logger.info(f"同步自选股到监控组: 新增 {len(added)} 只, 禁用 {len(disabled)} 只, 重新启用 {len(re_enabled)} 只")

        return result

    def _create_monitor_item_from_analysis(
        self, session: Session, group_id: int, code: str
    ) -> Optional[PriceMonitorItem]:
        """从最新分析记录创建监控项"""
        from src.storage import AnalysisHistory

        # 获取该股票最新分析记录
        row = session.execute(
            select(AnalysisHistory)
            .where(
                and_(
                    AnalysisHistory.code == code,
                    AnalysisHistory.ideal_buy.isnot(None),
                )
            )
            .order_by(AnalysisHistory.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

        if row:
            return PriceMonitorItem(
                group_id=group_id,
                code=code,
                name=row.name or code,
                ideal_buy=row.ideal_buy,
                secondary_buy=row.secondary_buy,
                stop_loss=row.stop_loss,
                take_profit=row.take_profit,
                is_active=True,
            )

        # 如果没有分析记录，创建一个空的监控项
        return PriceMonitorItem(
            group_id=group_id,
            code=code,
            name=code,
            ideal_buy=None,
            secondary_buy=None,
            stop_loss=None,
            take_profit=None,
            is_active=True,
        )

    def create_group(self, name: str, description: Optional[str] = None, owner_id: Optional[str] = None) -> int:
        """创建新的监控组"""
        with self.db.session_scope() as session:
            group = PriceMonitorGroup(
                name=name,
                description=description,
                owner_id=owner_id,
            )
            session.add(group)
            session.flush()
            return group.id

    def get_groups(self, owner_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """获取所有监控组列表"""
        with self.db.get_session() as session:
            query = select(PriceMonitorGroup)
            if owner_id:
                query = query.where(PriceMonitorGroup.owner_id == owner_id)

            groups = session.execute(query.order_by(PriceMonitorGroup.created_at)).scalars().all()

            result = []
            for g in groups:
                # 计算该组的监控项数量
                item_count = session.execute(
                    select(func.count(PriceMonitorItem.id)).where(PriceMonitorItem.group_id == g.id)
                ).scalar() or 0

                result.append({
                    "id": g.id,
                    "name": g.name,
                    "description": g.description,
                    "isDefault": g.is_default,
                    "itemCount": item_count,
                    "createdAt": g.created_at.isoformat() if g.created_at else None,
                    "updatedAt": g.updated_at.isoformat() if g.updated_at else None,
                })
            return result

    def get_group(self, group_id: int) -> Optional[Dict[str, Any]]:
        """获取单个监控组详情"""
        with self.db.get_session() as session:
            group = session.get(PriceMonitorGroup, group_id)
            if not group:
                return None

            return {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "isDefault": group.is_default,
                "createdAt": group.created_at.isoformat() if group.created_at else None,
                "updatedAt": group.updated_at.isoformat() if group.updated_at else None,
            }

    def update_group(self, group_id: int, name: Optional[str] = None, description: Optional[str] = None) -> bool:
        """更新监控组"""
        with self.db.session_scope() as session:
            group = session.get(PriceMonitorGroup, group_id)
            if not group:
                return False

            if name is not None:
                group.name = name
            if description is not None:
                group.description = description
            return True

    def delete_group(self, group_id: int) -> bool:
        """删除监控组（会级联删除所有监控项和告警记录）"""
        with self.db.session_scope() as session:
            group = session.get(PriceMonitorGroup, group_id)
            if not group:
                return False

            session.delete(group)
            return True

    # ========== 监控项管理 ==========

    def add_item(
        self,
        group_id: int,
        code: str,
        name: Optional[str] = None,
        ideal_buy: Optional[float] = None,
        secondary_buy: Optional[float] = None,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
    ) -> int:
        """添加监控项"""
        with self.db.session_scope() as session:
            # 如果名称未提供，尝试从最新分析获取
            if name is None:
                from src.storage import AnalysisHistory

                row = session.execute(
                    select(AnalysisHistory.name)
                    .where(AnalysisHistory.code == code)
                    .order_by(AnalysisHistory.created_at.desc())
                    .limit(1)
                ).scalar()
                name = row or code

            item = PriceMonitorItem(
                group_id=group_id,
                code=code.upper(),
                name=name,
                ideal_buy=ideal_buy,
                secondary_buy=secondary_buy,
                stop_loss=stop_loss,
                take_profit=take_profit,
                is_active=True,
            )
            session.add(item)
            session.flush()
            return item.id

    def update_item(
        self,
        item_id: int,
        ideal_buy: Optional[float] = None,
        secondary_buy: Optional[float] = None,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        is_active: Optional[bool] = None,
    ) -> bool:
        """更新监控项点位"""
        with self.db.session_scope() as session:
            item = session.get(PriceMonitorItem, item_id)
            if not item:
                return False

            if ideal_buy is not None:
                item.ideal_buy = ideal_buy
            if secondary_buy is not None:
                item.secondary_buy = secondary_buy
            if stop_loss is not None:
                item.stop_loss = stop_loss
            if take_profit is not None:
                item.take_profit = take_profit
            if is_active is not None:
                item.is_active = is_active

            return True

    def delete_item(self, item_id: int) -> bool:
        """删除监控项"""
        with self.db.session_scope() as session:
            item = session.get(PriceMonitorItem, item_id)
            if not item:
                return False

            session.delete(item)
            return True

    def toggle_item(self, item_id: int) -> Optional[bool]:
        """切换监控项启用状态"""
        with self.db.session_scope() as session:
            item = session.get(PriceMonitorItem, item_id)
            if not item:
                return None

            item.is_active = not item.is_active
            return item.is_active

    # ========== 实时快照 ==========

    def get_group_items(self, group_id: int) -> List[MonitorItemSnapshot]:
        """
        获取监控组的所有监控项（从数据库缓存读取，极速响应）

        直接读取 price_monitor_items 表中的 current_price, change_pct 字段，
        不实时查询行情，页面加载速度最快。
        """
        from sqlalchemy import select, and_

        with self.db.get_session() as session:
            items = session.execute(
                select(PriceMonitorItem).where(
                    and_(
                        PriceMonitorItem.group_id == group_id,
                        PriceMonitorItem.is_active == True,
                    )
                )
            ).scalars().all()

            snapshots = []
            has_price_count = 0
            for item in items:
                # 获取该股票最近触发的告警类型
                triggered = self._get_recent_triggered_types(session, item.id)

                snapshot = MonitorItemSnapshot(
                    id=item.id,
                    code=item.code,
                    name=item.name,
                    ideal_buy=item.ideal_buy,
                    secondary_buy=item.secondary_buy,
                    stop_loss=item.stop_loss,
                    take_profit=item.take_profit,
                    current_price=item.current_price,  # 从数据库缓存读取
                    change_pct=item.change_pct,  # 从数据库缓存读取
                    triggered_types=triggered,
                    is_active=item.is_active,
                    last_check_time=item.last_price_update.isoformat() if item.last_price_update else None,
                )
                if item.current_price is not None:
                    has_price_count += 1
                snapshots.append(snapshot)

            logger.info(f"[get_group_items] 读取 group_id={group_id}，共 {len(items)} 只，{has_price_count} 只有缓存价格")
            return snapshots

    def get_group_snapshot(self, group_id: int) -> List[MonitorItemSnapshot]:
        """获取监控组实时快照（含当前价格）"""
        with self.db.get_session() as session:
            items = session.execute(
                select(PriceMonitorItem).where(
                    and_(
                        PriceMonitorItem.group_id == group_id,
                        PriceMonitorItem.is_active == True,
                    )
                )
            ).scalars().all()

            if not items:
                return []

            # 批量获取实时价格
            codes = [item.code for item in items]
            quotes = self._get_realtime_quotes_batch(codes)

            snapshots = []
            for item in items:
                quote = quotes.get(item.code)

                # 获取该股票最近触发的告警类型（避免重复触发）
                triggered = self._get_recent_triggered_types(session, item.id)

                snapshot = MonitorItemSnapshot(
                    id=item.id,
                    code=item.code,
                    name=item.name,
                    ideal_buy=item.ideal_buy,
                    secondary_buy=item.secondary_buy,
                    stop_loss=item.stop_loss,
                    take_profit=item.take_profit,
                    current_price=quote.price if quote else None,
                    change_pct=quote.change_pct if quote else None,
                    triggered_types=triggered,
                    is_active=item.is_active,
                    last_check_time=datetime.now(),
                )
                snapshots.append(snapshot)

            return snapshots

    def _get_realtime_quotes_batch(self, codes: List[str]) -> Dict[str, UnifiedRealtimeQuote]:
        """批量获取实时行情"""
        quotes = {}
        for code in codes:
            try:
                quote = self.data_manager.get_realtime_quote(code)
                if quote:
                    quotes[code] = quote
            except Exception as e:
                logger.warning(f"获取 {code} 行情失败: {e}")
        return quotes

    def update_price_cache(self, group_id: Optional[int] = None) -> Dict[str, Any]:
        """
        更新数据库中的价格缓存（后台定时任务调用）

        获取所有活跃监控项的实时价格，更新到 price_monitor_items 表中，
        这样前端页面可以直接从数据库读取，无需等待实时行情。

        Args:
            group_id: 指定监控组，None则更新所有组

        Returns:
            更新统计信息
        """
        from sqlalchemy import select, and_

        updated = 0
        failed = 0
        total = 0

        with self.db.session_scope() as session:
            # 查询监控项
            query = select(PriceMonitorItem).where(PriceMonitorItem.is_active == True)
            if group_id:
                query = query.where(PriceMonitorItem.group_id == group_id)
            items = session.execute(query).scalars().all()

            total = len(items)
            if not items:
                return {"total": 0, "updated": 0, "failed": 0}

            # 批量获取实时价格
            codes = [item.code for item in items]
            quotes = self._get_realtime_quotes_batch(codes)

            # 更新数据库缓存
            now = datetime.now()
            for item in items:
                quote = quotes.get(item.code)
                if quote:
                    item.current_price = quote.price
                    item.change_pct = quote.change_pct
                    item.last_price_update = now
                    updated += 1
                else:
                    failed += 1

        result = {"total": total, "updated": updated, "failed": failed}
        if total > 0:
            logger.info(f"价格缓存更新完成: {updated}/{total} 成功, {failed} 失败")
        return result

    def _get_recent_triggered_types(self, session: Session, item_id: int, hours: int = 24) -> List[str]:
        """获取最近N小时内已触发的告警类型"""
        cutoff = datetime.now() - timedelta(hours=hours)
        alerts = session.execute(
            select(PriceMonitorAlert.trigger_type).where(
                and_(
                    PriceMonitorAlert.item_id == item_id,
                    PriceMonitorAlert.alert_time >= cutoff,
                )
            ).distinct()
        ).scalars().all()
        return list(alerts)

    # ========== 价格检查和告警 ==========

    def check_and_alert(self, group_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        执行一轮价格检查，触发告警

        Args:
            group_id: 指定监控组，None则检查所有组

        Returns:
            触发的告警列表
        """
        triggered_alerts = []

        with self.db.get_session() as session:
            # 查询监控项
            query = select(PriceMonitorItem).where(PriceMonitorItem.is_active == True)
            if group_id:
                query = query.where(PriceMonitorItem.group_id == group_id)
            items = session.execute(query).scalars().all()

            if not items:
                logger.info(f"[check_and_alert] 未找到监控项，group_id={group_id}")
                return []

            logger.info(f"[check_and_alert] 开始检查 {len(items)} 只股票的监控项")

            # 批量获取实时价格
            codes = [item.code for item in items]
            quotes = self._get_realtime_quotes_batch(codes)

            logger.info(f"[check_and_alert] 获取到 {len(quotes)} 只股票的实时行情")

            updated_count = 0
            for item in items:
                quote = quotes.get(item.code)
                if not quote:
                    logger.warning(f"[check_and_alert] 未获取到 {item.code} 的实时行情")
                    continue

                # 更新价格缓存（无论是否触发告警都更新）
                item.current_price = quote.price
                item.change_pct = quote.change_pct
                item.last_price_update = datetime.now()
                updated_count += 1

                logger.debug(f"[check_and_alert] 更新 {item.code} 价格缓存: price={quote.price}, change_pct={quote.change_pct}")

                # 获取最近已触发类型
                triggered_types = self._get_recent_triggered_types(session, item.id)

                # 检查触发条件
                new_triggers = self._check_triggers(quote.price, item, triggered_types)

                for trigger_type in new_triggers:
                    # 创建告警记录
                    alert = PriceMonitorAlert(
                        item_id=item.id,
                        trigger_type=trigger_type,
                        trigger_price=quote.price,
                    )
                    session.add(alert)
                    session.flush()

                    # 发送飞书通知
                    if self._send_alert(item, quote, trigger_type):
                        alert.is_sent = True
                        alert.sent_at = datetime.now()

                    triggered_alerts.append({
                        "id": alert.id,
                        "itemId": item.id,
                        "code": item.code,
                        "name": item.name,
                        "triggerType": trigger_type,
                        "triggerPrice": quote.price,
                        "alertTime": alert.alert_time.isoformat(),
                    })

            session.commit()
            logger.info(f"[check_and_alert] 完成，更新了 {updated_count} 只股票的价格缓存，触发 {len(triggered_alerts)} 条告警")

        return triggered_alerts

    def _check_triggers(
        self, price: float, item: PriceMonitorItem, triggered_types: List[str]
    ) -> List[str]:
        """检查触发条件，返回新触发的类型列表"""
        triggered = []

        # 理想买入点（现价 <= 理想买入点）
        if (
            item.ideal_buy
            and price <= item.ideal_buy
            and "IDEAL_BUY" not in triggered_types
        ):
            triggered.append("IDEAL_BUY")

        # 次选买入点
        if (
            item.secondary_buy
            and price <= item.secondary_buy
            and "SECONDARY_BUY" not in triggered_types
        ):
            triggered.append("SECONDARY_BUY")

        # 止损点
        if (
            item.stop_loss
            and price <= item.stop_loss
            and "STOP_LOSS" not in triggered_types
        ):
            triggered.append("STOP_LOSS")

        # 目标点
        if (
            item.take_profit
            and price >= item.take_profit
            and "TAKE_PROFIT" not in triggered_types
        ):
            triggered.append("TAKE_PROFIT")

        return triggered

    def _send_alert(self, item: PriceMonitorItem, quote: UnifiedRealtimeQuote, trigger_type: str) -> bool:
        """发送飞书告警通知"""
        if not self.feishu:
            return False

        type_names = {
            "IDEAL_BUY": "理想买入点",
            "SECONDARY_BUY": "次选买入点",
            "STOP_LOSS": "止损点",
            "TAKE_PROFIT": "目标点",
        }
        type_emojis = {
            "IDEAL_BUY": "🟢",
            "SECONDARY_BUY": "📌",
            "STOP_LOSS": "🔴",
            "TAKE_PROFIT": "🎯",
        }
        type_advice = {
            "IDEAL_BUY": "✅ 触发理想买入点，建议买入",
            "SECONDARY_BUY": "📌 触发次选买入点，可考虑买入",
            "STOP_LOSS": "⚠️ 触发止损，建议卖出",
            "TAKE_PROFIT": "🎯 达到目标价位，建议考虑止盈",
        }

        type_name = type_names.get(trigger_type, trigger_type)
        emoji = type_emojis.get(trigger_type, "🔔")
        advice = type_advice.get(trigger_type, "🔔 价格触发提醒")

        change_str = f"{quote.change_pct:+.2f}%" if quote.change_pct else "--"
        change_emoji = "📈" if quote.change_pct and quote.change_pct > 0 else "📉"

        # 构建点位状态列表
        def get_point_status(point_type: str, point_value: Optional[float]) -> str:
            """获取点位状态显示"""
            if not point_value:
                return f"• 点位类型：{point_type} | 设定值：- | 状态：⏸️ 未设置"

            # 判断该点位是否被触发
            is_triggered = False
            if point_type == "理想买入" and trigger_type == "IDEAL_BUY":
                is_triggered = True
            elif point_type == "次选买入" and trigger_type == "SECONDARY_BUY":
                is_triggered = True
            elif point_type == "止损点" and trigger_type == "STOP_LOSS":
                is_triggered = True
            elif point_type == "目标点" and trigger_type == "TAKE_PROFIT":
                is_triggered = True

            if is_triggered:
                return f"• 点位类型：{point_type} | 设定值：{point_value:.2f}元 | 状态：⚠️ 已触发"
            else:
                return f"• 点位类型：{point_type} | 设定值：{point_value:.2f}元 | 状态：⏳ 监控中"

        # 构建完整消息
        message = f"""A股智能分析报告
{emoji} {type_name}提醒

股票: {item.name} ({item.code})
当前价格: {quote.price:.2f}元  {change_emoji} {change_str}
触发类型: {emoji} {type_name}

📊 监控点位状态

{get_point_status("理想买入", item.ideal_buy)}
{get_point_status("次选买入", item.secondary_buy)}
{get_point_status("止损点", item.stop_loss)}
{get_point_status("目标点", item.take_profit)}

💡 操作建议

{advice}

────────
⏰ 触发时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
🔔 此提醒仅发送一次，同一点位不会重复提醒"""

        try:
            return self.feishu.send_to_feishu(message)
        except Exception as e:
            logger.error(f"发送飞书通知失败: {e}")
            return False

    # ========== 告警历史 ==========

    def get_alerts(
        self,
        group_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
        only_unsent: bool = False,
    ) -> List[Dict[str, Any]]:
        """获取告警历史"""
        with self.db.get_session() as session:
            query = select(PriceMonitorAlert, PriceMonitorItem).join(PriceMonitorItem)

            if group_id:
                query = query.where(PriceMonitorItem.group_id == group_id)
            if only_unsent:
                query = query.where(PriceMonitorAlert.is_sent == False)

            query = (
                query.order_by(PriceMonitorAlert.alert_time.desc())
                .offset(offset)
                .limit(limit)
            )

            results = session.execute(query).all()

            return [
                {
                    "id": alert.id,
                    "itemId": item.id,
                    "code": item.code,
                    "name": item.name,
                    "triggerType": alert.trigger_type,
                    "triggerPrice": alert.trigger_price,
                    "alertTime": alert.alert_time.isoformat() if alert.alert_time else None,
                    "isSent": alert.is_sent,
                    "sentAt": alert.sent_at.isoformat() if alert.sent_at else None,
                }
                for alert, item in results
            ]

    def ack_alert(self, alert_id: int) -> bool:
        """确认告警（标记为已发送）"""
        with self.db.session_scope() as session:
            alert = session.get(PriceMonitorAlert, alert_id)
            if not alert:
                return False

            alert.is_sent = True
            alert.sent_at = datetime.now()
            return True


# 便捷函数 - 使用延迟初始化
_get_monitor_service_instance = None

def get_monitor_service() -> PriceMonitorService:
    """
    获取监控服务实例（延迟初始化）

    第一次调用时创建实例，后续调用返回缓存的实例。
    避免在模块导入时初始化 DatabaseManager。
    """
    global _get_monitor_service_instance
    if _get_monitor_service_instance is None:
        db = DatabaseManager.get_instance()
        config = get_config()
        _get_monitor_service_instance = PriceMonitorService(db, config)
    return _get_monitor_service_instance
