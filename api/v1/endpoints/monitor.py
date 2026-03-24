# -*- coding: utf-8 -*-
"""
===================================
价格监控 API 端点
===================================

提供监控组管理、监控项配置、实时状态查询、告警历史等功能
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_current_user_id
from api.v1.schemas.monitor import (
    MonitorGroupCreateRequest,
    MonitorGroupItem,
    MonitorGroupListResponse,
    MonitorGroupUpdateRequest,
    MonitorItemCreateRequest,
    MonitorItemSnapshot,
    MonitorItemUpdateRequest,
    MonitorSnapshotResponse,
    MonitorAlertItem,
    MonitorAlertListResponse,
    MonitorCheckResponse,
)
from src.services.price_monitor_service import get_monitor_service, PriceMonitorService

router = APIRouter()


# ========== 监控组管理 ==========

@router.get("/groups", response_model=MonitorGroupListResponse)
async def list_groups(
    owner_id: Optional[str] = Depends(get_current_user_id),
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """获取所有监控组列表"""
    groups = service.get_groups(owner_id=owner_id)
    return MonitorGroupListResponse(groups=[MonitorGroupItem(**g) for g in groups])


@router.post("/groups", response_model=MonitorGroupItem)
async def create_group(
    request: MonitorGroupCreateRequest,
    owner_id: Optional[str] = Depends(get_current_user_id),
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """创建新的监控组"""
    group_id = service.create_group(
        name=request.name,
        description=request.description,
        owner_id=owner_id,
    )
    group = service.get_group(group_id)
    return MonitorGroupItem(**group)


@router.get("/groups/{group_id}", response_model=MonitorGroupItem)
async def get_group(
    group_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """获取监控组详情"""
    group = service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="监控组不存在")
    return MonitorGroupItem(**group)


@router.put("/groups/{group_id}", response_model=MonitorGroupItem)
async def update_group(
    group_id: int,
    request: MonitorGroupUpdateRequest,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """更新监控组"""
    success = service.update_group(
        group_id=group_id,
        name=request.name,
        description=request.description,
    )
    if not success:
        raise HTTPException(status_code=404, detail="监控组不存在")

    group = service.get_group(group_id)
    return MonitorGroupItem(**group)


@router.delete("/groups/{group_id}")
async def delete_group(
    group_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """删除监控组"""
    success = service.delete_group(group_id)
    if not success:
        raise HTTPException(status_code=404, detail="监控组不存在")
    return {"deleted": True}


@router.post("/groups/default")
async def ensure_default_group(
    owner_id: Optional[str] = Depends(get_current_user_id),
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """确保存在默认监控组（从 STOCK_LIST 创建）"""
    group_id = service.ensure_default_group(owner_id=owner_id)
    if not group_id:
        raise HTTPException(status_code=400, detail="创建默认监控组失败，请检查 STOCK_LIST 配置")

    group = service.get_group(group_id)
    return MonitorGroupItem(**group)


@router.post("/groups/sync-watchlist")
async def sync_watchlist(
    owner_id: Optional[str] = Depends(get_current_user_id),
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """
    手动同步自选股到默认监控组

    将当前 STOCK_LIST 配置与监控组同步：
    - 新增 STOCK_LIST 中有但监控组中没有的股票
    - 将不在 STOCK_LIST 中的股票标记为禁用（软删除，非物理删除）
    - 重新启用之前被禁用但现在在 STOCK_LIST 中的股票
    """
    result = service.sync_watchlist_to_default_group(owner_id=owner_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ========== 监控组快照 ==========

@router.get("/groups/{group_id}/items", response_model=List[MonitorItemSnapshot])
async def get_group_items(
    group_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """
    获取监控组的所有监控项（不含实时价格，快速响应）

    用于页面初始加载，返回数据库中的监控配置，不查询实时行情。
    实时价格需要通过 /snapshot 或 /refresh-prices 获取。
    """
    group = service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="监控组不存在")

    items = service.get_group_items(group_id)
    return [MonitorItemSnapshot(**item.to_dict()) for item in items]


@router.get("/groups/{group_id}/snapshot", response_model=MonitorSnapshotResponse)
async def get_group_snapshot(
    group_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """获取监控组实时快照（含当前价格）- 较慢，会阻塞等待实时行情"""
    group = service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="监控组不存在")

    snapshots = service.get_group_snapshot(group_id)
    return MonitorSnapshotResponse(
        groupId=group_id,
        groupName=group["name"],
        items=[MonitorItemSnapshot(**s.to_dict()) for s in snapshots],
        checkTime=datetime.now().isoformat(),
    )


@router.post("/groups/{group_id}/refresh-prices", response_model=List[MonitorItemSnapshot])
async def refresh_group_prices(
    group_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """
    刷新监控组的实时价格（异步更新）

    返回包含最新价格的监控项列表。此操作会实时查询行情，可能较慢。
    建议前端先调用 /items 获取基础数据，再调用此接口刷新价格。
    """
    group = service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="监控组不存在")

    snapshots = service.get_group_snapshot(group_id)
    return [MonitorItemSnapshot(**s.to_dict()) for s in snapshots]


@router.post("/update-price-cache", response_model=dict)
async def update_price_cache(
    group_id: Optional[int] = Query(None, description="指定监控组，不传则更新所有"),
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """
    更新价格缓存（后台任务）

    获取实时价格并更新到数据库，供后续快速查询使用。
    页面加载时直接读取数据库缓存，无需等待实时行情。
    """
    result = service.update_price_cache(group_id=group_id)
    return result


# ========== 监控项管理 ==========

@router.post("/items", response_model=dict)
async def add_item(
    request: MonitorItemCreateRequest,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """添加监控项"""
    item_id = service.add_item(
        group_id=request.groupId,
        code=request.code,
        name=request.name,
        ideal_buy=request.idealBuy,
        secondary_buy=request.secondaryBuy,
        stop_loss=request.stopLoss,
        take_profit=request.takeProfit,
    )
    return {"id": item_id, "message": "监控项添加成功"}


@router.put("/items/{item_id}", response_model=dict)
async def update_item(
    item_id: int,
    request: MonitorItemUpdateRequest,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """更新监控项点位"""
    success = service.update_item(
        item_id=item_id,
        ideal_buy=request.idealBuy,
        secondary_buy=request.secondaryBuy,
        stop_loss=request.stopLoss,
        take_profit=request.takeProfit,
        is_active=request.isActive,
    )
    if not success:
        raise HTTPException(status_code=404, detail="监控项不存在")
    return {"message": "监控项更新成功"}


@router.delete("/items/{item_id}")
async def delete_item(
    item_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """删除监控项"""
    success = service.delete_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="监控项不存在")
    return {"deleted": True}


@router.post("/items/{item_id}/toggle", response_model=dict)
async def toggle_item(
    item_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """切换监控项启用状态"""
    new_state = service.toggle_item(item_id)
    if new_state is None:
        raise HTTPException(status_code=404, detail="监控项不存在")
    return {"isActive": new_state}


# ========== 告警历史 ==========

@router.get("/alerts", response_model=MonitorAlertListResponse)
async def list_alerts(
    group_id: Optional[int] = Query(None, description="按监控组筛选"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    only_unsent: bool = Query(False, description="仅显示未发送的告警"),
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """获取告警历史"""
    alerts = service.get_alerts(
        group_id=group_id,
        limit=limit,
        offset=offset,
        only_unsent=only_unsent,
    )
    return MonitorAlertListResponse(
        alerts=[MonitorAlertItem(**a) for a in alerts],
        total=len(alerts),
    )


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(
    alert_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """确认告警（标记为已处理）"""
    success = service.ack_alert(alert_id)
    if not success:
        raise HTTPException(status_code=404, detail="告警不存在")
    return {"acked": True}


# ========== 手动检查 ==========

@router.post("/check", response_model=MonitorCheckResponse)
async def manual_check(
    group_id: Optional[int] = Query(None, description="指定监控组，不传则检查所有"),
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """手动执行一次价格检查"""
    triggered = service.check_and_alert(group_id=group_id)
    return MonitorCheckResponse(
        triggered=triggered,
        message=f"检查完成，触发 {len(triggered)} 条告警",
    )


@router.post("/check/{group_id}/dry-run", response_model=List[MonitorItemSnapshot])
async def dry_run_check(
    group_id: int,
    service: PriceMonitorService = Depends(get_monitor_service),
):
    """试运行检查（只检查不发送通知，也不记录告警）"""
    group = service.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="监控组不存在")

    snapshots = service.get_group_snapshot(group_id)
    return [MonitorItemSnapshot(**s.to_dict()) for s in snapshots]
