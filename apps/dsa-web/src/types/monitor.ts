/**
 * 价格监控相关类型定义
 */

export interface MonitorGroupItem {
  id: number;
  name: string;
  description?: string;
  isDefault: boolean;
  itemCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface MonitorGroupListResponse {
  groups: MonitorGroupItem[];
}

export interface MonitorItemSnapshot {
  id: number;
  code: string;
  name: string;
  idealBuy?: number;
  secondaryBuy?: number;
  stopLoss?: number;
  takeProfit?: number;
  currentPrice?: number;
  changePct?: number;
  distanceToIdeal?: number;
  distanceToStop?: number;
  distanceToTarget?: number;
  triggeredTypes: string[];
  isActive: boolean;
  lastCheckTime?: string;
}

export interface MonitorSnapshotResponse {
  groupId: number;
  groupName: string;
  items: MonitorItemSnapshot[];
  checkTime: string;
}

export interface MonitorAlertItem {
  id: number;
  itemId: number;
  code: string;
  name: string;
  triggerType: string;
  triggerPrice: number;
  alertTime: string;
  isSent: boolean;
  sentAt?: string;
}

export interface MonitorAlertListResponse {
  alerts: MonitorAlertItem[];
  total: number;
}

export interface MonitorCheckResponse {
  triggered: Array<{
    id: number;
    itemId: number;
    code: string;
    name: string;
    triggerType: string;
    triggerPrice: number;
    alertTime: string;
  }>;
  message: string;
}

export type TriggerType = 'IDEAL_BUY' | 'SECONDARY_BUY' | 'STOP_LOSS' | 'TAKE_PROFIT';

export const TRIGGER_TYPE_LABELS: Record<TriggerType, { label: string; emoji: string; color: string }> = {
  IDEAL_BUY: { label: '理想买入', emoji: '✅', color: '#00d4ff' },
  SECONDARY_BUY: { label: '次选买入', emoji: '📌', color: '#00ff88' },
  STOP_LOSS: { label: '止损', emoji: '🚨', color: '#ff4466' },
  TAKE_PROFIT: { label: '目标', emoji: '🎯', color: '#ffaa00' },
};
