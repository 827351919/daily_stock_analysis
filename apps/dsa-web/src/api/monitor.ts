import apiClient from './index';
import { toCamelCase } from './utils';
import type {
  MonitorGroupItem,
  MonitorGroupListResponse,
  MonitorItemSnapshot,
  MonitorSnapshotResponse,
  MonitorAlertListResponse,
  MonitorCheckResponse,
} from '../types/monitor';

export interface CreateGroupRequest {
  name: string;
  description?: string;
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string;
}

export interface CreateItemRequest {
  groupId: number;
  code: string;
  name?: string;
  idealBuy?: number;
  secondaryBuy?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface UpdateItemRequest {
  idealBuy?: number;
  secondaryBuy?: number;
  stopLoss?: number;
  takeProfit?: number;
  isActive?: boolean;
}

export const monitorApi = {
  // ========== 监控组管理 ==========

  async getGroups(): Promise<MonitorGroupListResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/monitor/groups');
    return toCamelCase<MonitorGroupListResponse>(response.data);
  },

  async createGroup(payload: CreateGroupRequest): Promise<MonitorGroupItem> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/monitor/groups', {
      name: payload.name,
      description: payload.description,
    });
    return toCamelCase<MonitorGroupItem>(response.data);
  },

  async getGroup(groupId: number): Promise<MonitorGroupItem> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/monitor/groups/${groupId}`);
    return toCamelCase<MonitorGroupItem>(response.data);
  },

  async updateGroup(groupId: number, payload: UpdateGroupRequest): Promise<MonitorGroupItem> {
    const response = await apiClient.put<Record<string, unknown>>(`/api/v1/monitor/groups/${groupId}`, {
      name: payload.name,
      description: payload.description,
    });
    return toCamelCase<MonitorGroupItem>(response.data);
  },

  async deleteGroup(groupId: number): Promise<{ deleted: boolean }> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/monitor/groups/${groupId}`);
    return toCamelCase<{ deleted: boolean }>(response.data);
  },

  async ensureDefaultGroup(): Promise<MonitorGroupItem> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/monitor/groups/default');
    return toCamelCase<MonitorGroupItem>(response.data);
  },

  async syncWatchlist(): Promise<{ added: string[]; disabled: string[]; reEnabled: string[]; total: number }> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/monitor/groups/sync-watchlist');
    return toCamelCase<{ added: string[]; disabled: string[]; reEnabled: string[]; total: number }>(response.data);
  },

  // ========== 监控组数据（快速加载，不含实时价格） ==========

  async getGroupItems(groupId: number): Promise<MonitorItemSnapshot[]> {
    const response = await apiClient.get<Record<string, unknown>[]>(`/api/v1/monitor/groups/${groupId}/items`);
    return toCamelCase<MonitorItemSnapshot[]>(response.data);
  },

  // ========== 监控组快照（含实时价格，较慢） ==========

  async getGroupSnapshot(groupId: number): Promise<MonitorSnapshotResponse> {
    const response = await apiClient.get<Record<string, unknown>>(`/api/v1/monitor/groups/${groupId}/snapshot`);
    return toCamelCase<MonitorSnapshotResponse>(response.data);
  },

  // ========== 刷新实时价格 ==========

  async refreshGroupPrices(groupId: number): Promise<MonitorItemSnapshot[]> {
    const response = await apiClient.post<Record<string, unknown>[]>(`/api/v1/monitor/groups/${groupId}/refresh-prices`);
    return toCamelCase<MonitorItemSnapshot[]>(response.data);
  },

  // ========== 监控项管理 ==========

  async addItem(payload: CreateItemRequest): Promise<{ id: number; message: string }> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/monitor/items', {
      group_id: payload.groupId,
      code: payload.code,
      name: payload.name,
      ideal_buy: payload.idealBuy,
      secondary_buy: payload.secondaryBuy,
      stop_loss: payload.stopLoss,
      take_profit: payload.takeProfit,
    });
    return toCamelCase<{ id: number; message: string }>(response.data);
  },

  async updateItem(itemId: number, payload: UpdateItemRequest): Promise<{ message: string }> {
    const response = await apiClient.put<Record<string, unknown>>(`/api/v1/monitor/items/${itemId}`, {
      ideal_buy: payload.idealBuy,
      secondary_buy: payload.secondaryBuy,
      stop_loss: payload.stopLoss,
      take_profit: payload.takeProfit,
      is_active: payload.isActive,
    });
    return toCamelCase<{ message: string }>(response.data);
  },

  async deleteItem(itemId: number): Promise<{ deleted: boolean }> {
    const response = await apiClient.delete<Record<string, unknown>>(`/api/v1/monitor/items/${itemId}`);
    return toCamelCase<{ deleted: boolean }>(response.data);
  },

  async toggleItem(itemId: number): Promise<{ isActive: boolean }> {
    const response = await apiClient.post<Record<string, unknown>>(`/api/v1/monitor/items/${itemId}/toggle`);
    return toCamelCase<{ isActive: boolean }>(response.data);
  },

  // ========== 告警历史 ==========

  async getAlerts(params?: {
    groupId?: number;
    limit?: number;
    offset?: number;
    onlyUnsent?: boolean;
  }): Promise<MonitorAlertListResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/monitor/alerts', {
      params: {
        group_id: params?.groupId,
        limit: params?.limit ?? 50,
        offset: params?.offset ?? 0,
        only_unsent: params?.onlyUnsent ?? false,
      },
    });
    return toCamelCase<MonitorAlertListResponse>(response.data);
  },

  async ackAlert(alertId: number): Promise<{ acked: boolean }> {
    const response = await apiClient.post<Record<string, unknown>>(`/api/v1/monitor/alerts/${alertId}/ack`);
    return toCamelCase<{ acked: boolean }>(response.data);
  },

  // ========== 手动检查 ==========

  async manualCheck(groupId?: number): Promise<MonitorCheckResponse> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/monitor/check', undefined, {
      params: groupId ? { group_id: groupId } : undefined,
    });
    return toCamelCase<MonitorCheckResponse>(response.data);
  },

  async dryRunCheck(groupId: number): Promise<MonitorItemSnapshot[]> {
    const response = await apiClient.post<Record<string, unknown>>(`/api/v1/monitor/check/${groupId}/dry-run`);
    return toCamelCase<MonitorItemSnapshot[]>(response.data);
  },
};
