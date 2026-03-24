# -*- coding: utf-8 -*-
"""价格监控 API schemas."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class MonitorGroupCreateRequest(BaseModel):
    """创建监控组请求"""
    name: str = Field(..., min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=255)


class MonitorGroupUpdateRequest(BaseModel):
    """更新监控组请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = Field(None, max_length=255)


class MonitorGroupItem(BaseModel):
    """监控组列表项"""
    id: int
    name: str
    description: Optional[str] = None
    isDefault: bool = False
    itemCount: int = 0
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class MonitorGroupListResponse(BaseModel):
    """监控组列表响应"""
    groups: List[MonitorGroupItem] = Field(default_factory=list)


class MonitorItemCreateRequest(BaseModel):
    """创建监控项请求"""
    groupId: int = Field(..., alias="group_id")
    code: str = Field(..., min_length=1, max_length=16)
    name: Optional[str] = Field(None, max_length=64)
    idealBuy: Optional[float] = Field(None, alias="ideal_buy")
    secondaryBuy: Optional[float] = Field(None, alias="secondary_buy")
    stopLoss: Optional[float] = Field(None, alias="stop_loss")
    takeProfit: Optional[float] = Field(None, alias="take_profit")

    class Config:
        populate_by_name = True


class MonitorItemUpdateRequest(BaseModel):
    """更新监控项请求"""
    idealBuy: Optional[float] = Field(None, alias="ideal_buy")
    secondaryBuy: Optional[float] = Field(None, alias="secondary_buy")
    stopLoss: Optional[float] = Field(None, alias="stop_loss")
    takeProfit: Optional[float] = Field(None, alias="take_profit")
    isActive: Optional[bool] = Field(None, alias="is_active")

    class Config:
        populate_by_name = True


class MonitorItemSnapshot(BaseModel):
    """监控项实时快照（含当前价格）"""
    id: int
    code: str
    name: str
    idealBuy: Optional[float] = None
    secondaryBuy: Optional[float] = None
    stopLoss: Optional[float] = None
    takeProfit: Optional[float] = None
    currentPrice: Optional[float] = None
    changePct: Optional[float] = None
    distanceToIdeal: Optional[float] = None
    distanceToStop: Optional[float] = None
    distanceToTarget: Optional[float] = None
    triggeredTypes: List[str] = Field(default_factory=list)
    isActive: bool = True
    lastCheckTime: Optional[str] = None


class MonitorSnapshotResponse(BaseModel):
    """监控组快照响应"""
    groupId: int
    groupName: str
    items: List[MonitorItemSnapshot] = Field(default_factory=list)
    checkTime: str


class MonitorAlertItem(BaseModel):
    """告警记录项"""
    id: int
    itemId: int
    code: str
    name: str
    triggerType: str
    triggerPrice: float
    alertTime: str
    isSent: bool
    sentAt: Optional[str] = None


class MonitorAlertListResponse(BaseModel):
    """告警列表响应"""
    alerts: List[MonitorAlertItem] = Field(default_factory=list)
    total: int = 0


class MonitorCheckResponse(BaseModel):
    """手动检查响应"""
    triggered: List[dict] = Field(default_factory=list)
    message: str = ""


class MonitorTriggerCheckResponse(BaseModel):
    """触发检查响应"""
    itemId: int
    code: str
    name: str
    triggeredTypes: List[str]
    currentPrice: Optional[float]
