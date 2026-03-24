# -*- coding: utf-8 -*-
"""
===================================
价格监控后台更新器
===================================

职责：
1. 定期更新监控项的价格缓存到数据库
2. 使前端页面能快速从数据库读取价格，无需等待实时行情

使用方式：
    from src.auto_trade.monitor_worker import MonitorPriceUpdater
    updater = MonitorPriceUpdater(service)
    asyncio.create_task(updater.run(interval_seconds=60))
"""

import asyncio
import logging
from datetime import datetime, time
from typing import Optional

from src.services.price_monitor_service import PriceMonitorService

logger = logging.getLogger(__name__)


class MonitorPriceUpdater:
    """
    监控价格后台更新器

    定期刷新所有活跃监控项的实时价格，存入数据库缓存。
    前端页面直接从数据库读取，实现极速加载。
    """

    def __init__(self, service: PriceMonitorService):
        self.service = service
        self._stop_event = asyncio.Event()
        self._last_update: Optional[datetime] = None

    async def run(self, interval_seconds: int = 60):
        """
        持续运行价格更新循环

        Args:
            interval_seconds: 更新间隔（秒），默认60秒
        """
        logger.info(f"价格缓存更新器启动，更新间隔: {interval_seconds}秒")

        # 立即执行一次更新
        await self._do_update()

        while not self._stop_event.is_set():
            try:
                # 等待间隔或停止信号
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=interval_seconds
                )
            except asyncio.TimeoutError:
                # 正常超时，执行更新
                if self._should_update():
                    await self._do_update()

        logger.info("价格缓存更新器已停止")

    def _should_update(self) -> bool:
        """
        判断是否应该执行更新

        只在交易时段更新（9:30-11:30, 13:00-15:00）
        非交易时段可以延长间隔以节省资源
        """
        now = datetime.now().time()

        # 交易时段
        morning_start = time(9, 30)
        morning_end = time(11, 30)
        afternoon_start = time(13, 0)
        afternoon_end = time(15, 0)

        is_trading_hours = (
            (morning_start <= now <= morning_end) or
            (afternoon_start <= now <= afternoon_end)
        )

        return is_trading_hours

    async def _do_update(self):
        """执行一次价格缓存更新"""
        try:
            result = self.service.update_price_cache()
            self._last_update = datetime.now()

            if result["total"] > 0:
                logger.debug(
                    f"价格缓存更新: {result['updated']}/{result['total']} 成功"
                )
        except Exception as e:
            logger.error(f"价格缓存更新失败: {e}")

    def stop(self):
        """停止更新器"""
        self._stop_event.set()

    @property
    def last_update(self) -> Optional[datetime]:
        """获取最后一次更新时间"""
        return self._last_update
