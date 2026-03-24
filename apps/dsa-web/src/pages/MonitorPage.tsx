import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { monitorApi } from '../api/monitor';
import type { ParsedApiError } from '../api/error';
import { getParsedApiError } from '../api/error';
import { ApiErrorAlert, Card, Badge, ConfirmDialog } from '../components/common';
import type {
  MonitorGroupItem,
  MonitorItemSnapshot,
  MonitorAlertItem,
} from '../types/monitor';
import { TRIGGER_TYPE_LABELS } from '../types/monitor';

type TabMode = 'groups' | 'alerts';

interface GroupDialogState {
  open: boolean;
  editing: MonitorGroupItem | null;
  name: string;
  description: string;
}

interface ItemDialogState {
  open: boolean;
  editing: MonitorItemSnapshot | null;
  code: string;
  name: string;
  idealBuy: string;
  secondaryBuy: string;
  stopLoss: string;
  takeProfit: string;
}

export default function MonitorPage(): React.ReactElement {
  // ========== 状态 ==========
  const [groups, setGroups] = useState<MonitorGroupItem[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<MonitorItemSnapshot[]>([]);
  const [alerts, setAlerts] = useState<MonitorAlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [activeTab, setActiveTab] = useState<TabMode>('groups');

  const [groupDialog, setGroupDialog] = useState<GroupDialogState>({
    open: false,
    editing: null,
    name: '',
    description: '',
  });

  const [itemDialog, setItemDialog] = useState<ItemDialogState>({
    open: false,
    editing: null,
    code: '',
    name: '',
    idealBuy: '',
    secondaryBuy: '',
    stopLoss: '',
    takeProfit: '',
  });

  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    type: 'group' | 'item';
    id: number;
    name: string;
  }>({ open: false, type: 'group', id: 0, name: '' });

  const [refreshInterval, setRefreshInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // ========== 数据加载 ==========
  const loadGroups = useCallback(async () => {
    try {
      const data = await monitorApi.getGroups();
      setGroups(data.groups);

      // 如果没有选中组，选择第一个或默认组
      if (data.groups.length > 0 && !activeGroupId) {
        const defaultGroup = data.groups.find((g) => g.isDefault);
        setActiveGroupId(defaultGroup?.id ?? data.groups[0].id);
      }
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, [activeGroupId]);

  const loadSnapshot = useCallback(async () => {
    if (!activeGroupId) return;

    setLoading(true);
    try {
      // 从数据库缓存读取价格（极速响应）
      const items = await monitorApi.getGroupItems(activeGroupId);
      setSnapshot(items);
      setLastRefresh(new Date());
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  }, [activeGroupId]);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await monitorApi.getAlerts({ limit: 20 });
      setAlerts(data.alerts);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadGroups();
    loadAlerts();
  }, [loadGroups, loadAlerts]);

  // 加载选中组的快照
  useEffect(() => {
    if (activeGroupId) {
      loadSnapshot();
    }
  }, [activeGroupId, loadSnapshot]);

  // 自动刷新（每30秒）
  useEffect(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }

    const interval = setInterval(() => {
      if (activeGroupId && activeTab === 'groups') {
        loadSnapshot();
      }
    }, 30000);

    setRefreshInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeGroupId, activeTab, loadSnapshot]);

  // ========== 操作 ==========
  const handleCreateDefaultGroup = async () => {
    try {
      setLoading(true);
      await monitorApi.ensureDefaultGroup();
      await loadGroups();
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGroup = async () => {
    const { editing, name, description } = groupDialog;
    if (!name.trim()) return;

    try {
      setLoading(true);
      if (editing) {
        await monitorApi.updateGroup(editing.id, { name, description });
      } else {
        await monitorApi.createGroup({ name, description });
      }
      await loadGroups();
      setGroupDialog({ open: false, editing: null, name: '', description: '' });
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    const { id } = deleteConfirm;
    try {
      setLoading(true);
      await monitorApi.deleteGroup(id);
      if (activeGroupId === id) {
        setActiveGroupId(null);
      }
      await loadGroups();
      setDeleteConfirm({ open: false, type: 'group', id: 0, name: '' });
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveItem = async () => {
    const { editing, code, name, idealBuy, secondaryBuy, stopLoss, takeProfit } = itemDialog;
    if (!activeGroupId || !code.trim()) return;

    try {
      setLoading(true);
      if (editing) {
        await monitorApi.updateItem(editing.id, {
          idealBuy: idealBuy ? parseFloat(idealBuy) : undefined,
          secondaryBuy: secondaryBuy ? parseFloat(secondaryBuy) : undefined,
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
        });
      } else {
        await monitorApi.addItem({
          groupId: activeGroupId,
          code: code.trim().toUpperCase(),
          name: name.trim() || undefined,
          idealBuy: idealBuy ? parseFloat(idealBuy) : undefined,
          secondaryBuy: secondaryBuy ? parseFloat(secondaryBuy) : undefined,
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
        });
      }
      await loadSnapshot();
      setItemDialog({
        open: false,
        editing: null,
        code: '',
        name: '',
        idealBuy: '',
        secondaryBuy: '',
        stopLoss: '',
        takeProfit: '',
      });
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async () => {
    const { id } = deleteConfirm;
    try {
      setLoading(true);
      await monitorApi.deleteItem(id);
      await loadSnapshot();
      setDeleteConfirm({ open: false, type: 'item', id: 0, name: '' });
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleItem = async (itemId: number) => {
    try {
      await monitorApi.toggleItem(itemId);
      await loadSnapshot();
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const handleManualCheck = async () => {
    try {
      setLoading(true);
      await monitorApi.manualCheck(activeGroupId ?? undefined);
      await loadSnapshot();
      await loadAlerts();
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSyncWatchlist = async () => {
    try {
      setLoading(true);
      const result = await monitorApi.syncWatchlist();
      await loadGroups();
      await loadSnapshot();
      // 显示同步结果
      const messages = [];
      if (result.added.length > 0) messages.push(`新增 ${result.added.length} 只`);
      if (result.disabled.length > 0) messages.push(`禁用 ${result.disabled.length} 只`);
      if (result.reEnabled.length > 0) messages.push(`重新启用 ${result.reEnabled.length} 只`);
      if (messages.length === 0) {
        alert('自选股已是最新状态');
      } else {
        alert(`同步完成: ${messages.join(', ')}`);
      }
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
    }
  };

  // ========== 渲染辅助 ==========
  const formatDistance = (value: number | undefined) => {
    if (value === undefined || value === null) return '--';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const getDistanceColor = (value: number | undefined) => {
    if (value === undefined || value === null) return '#888';
    if (value <= 0) return '#ff4466'; // 已触发或接近
    if (value <= 5) return '#ffaa00'; // 接近
    return '#00ff88'; // 距离较远
  };

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId),
    [groups, activeGroupId]
  );

  // ========== 渲染 ==========
  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {error && <ApiErrorAlert error={error} onDismiss={() => setError(null)} />}

      {/* 页面标题 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#fff' }}>价格监控</h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: '14px' }}>
            上次刷新: {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={handleManualCheck}
            disabled={loading}
            style={{
              padding: '8px 16px',
              background: '#00d4ff',
              border: 'none',
              borderRadius: '4px',
              color: '#000',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '检查中...' : '立即检查'}
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid #333' }}>
        <button
          onClick={() => setActiveTab('groups')}
          style={{
            padding: '12px 24px',
            background: activeTab === 'groups' ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'groups' ? '2px solid #00d4ff' : '2px solid transparent',
            color: activeTab === 'groups' ? '#00d4ff' : '#888',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'groups' ? 600 : 400,
          }}
        >
          监控组
        </button>
        <button
          onClick={() => setActiveTab('alerts')}
          style={{
            padding: '12px 24px',
            background: activeTab === 'alerts' ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === 'alerts' ? '2px solid #00d4ff' : '2px solid transparent',
            color: activeTab === 'alerts' ? '#00d4ff' : '#888',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'alerts' ? 600 : 400,
          }}
        >
          告警历史
        </button>
      </div>

      {/* 监控组 Tab */}
      {activeTab === 'groups' && (
        <>
          {/* 组列表 Tab */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => setActiveGroupId(group.id)}
                style={{
                  padding: '10px 20px',
                  background: activeGroupId === group.id ? '#00d4ff' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${activeGroupId === group.id ? '#00d4ff' : '#333'}`,
                  borderRadius: '4px',
                  color: activeGroupId === group.id ? '#000' : '#fff',
                  cursor: 'pointer',
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {group.name}
                {group.isDefault && (
                  <span style={{ fontSize: '12px', opacity: 0.8 }}>(默认)</span>
                )}
                <Badge variant={activeGroupId === group.id ? 'default' : 'info'}>
                  {group.itemCount}
                </Badge>
              </button>
            ))}

            <button
              onClick={() => setGroupDialog({ open: true, editing: null, name: '', description: '' })}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: '1px dashed #666',
                borderRadius: '4px',
                color: '#888',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              + 新建监控组
            </button>

            {groups.length === 0 && (
              <button
                onClick={handleCreateDefaultGroup}
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(0, 212, 255, 0.1)',
                  border: '1px solid #00d4ff',
                  borderRadius: '4px',
                  color: '#00d4ff',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                }}
              >
                从自选股创建默认组
              </button>
            )}
          </div>

          {/* 组操作按钮 */}
          {activeGroup && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button
                onClick={() =>
                  setGroupDialog({
                    open: true,
                    editing: activeGroup,
                    name: activeGroup.name,
                    description: activeGroup.description || '',
                  })
                }
                style={{
                  padding: '6px 12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                编辑组
              </button>
              {/* 自选股组显示同步按钮，非自选股组显示删除按钮 */}
              {activeGroup.isDefault ? (
                <button
                  onClick={handleSyncWatchlist}
                  disabled={loading}
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(0, 255, 136, 0.1)',
                    border: '1px solid rgba(0, 255, 136, 0.3)',
                    borderRadius: '4px',
                    color: '#00ff88',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                  }}
                >
                  同步自选股
                </button>
              ) : (
                <button
                  onClick={() =>
                    setDeleteConfirm({
                      open: true,
                      type: 'group',
                      id: activeGroup.id,
                      name: activeGroup.name,
                    })
                  }
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(255, 68, 102, 0.1)',
                    border: '1px solid rgba(255, 68, 102, 0.3)',
                    borderRadius: '4px',
                    color: '#ff4466',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  删除组
                </button>
              )}
              <button
                onClick={() =>
                  setItemDialog({
                    open: true,
                    editing: null,
                    code: '',
                    name: '',
                    idealBuy: '',
                    secondaryBuy: '',
                    stopLoss: '',
                    takeProfit: '',
                  })
                }
                style={{
                  padding: '6px 12px',
                  background: 'rgba(0, 212, 255, 0.1)',
                  border: '1px solid #00d4ff',
                  borderRadius: '4px',
                  color: '#00d4ff',
                  cursor: 'pointer',
                  fontSize: '12px',
                  marginLeft: 'auto',
                }}
              >
                + 添加股票
              </button>
            </div>
          )}

          {/* 监控表格 */}
          <Card>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#888', fontSize: '14px' }}>代码</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#888', fontSize: '14px' }}>名称</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: '14px' }}>现价</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: '14px' }}>理想买入</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: '14px' }}>次选买入</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: '14px' }}>止损</th>
                    <th style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: '14px' }}>目标</th>
                    <th style={{ padding: '12px', textAlign: 'center', color: '#888', fontSize: '14px' }}>距离</th>
                    <th style={{ padding: '12px', textAlign: 'center', color: '#888', fontSize: '14px' }}>状态</th>
                    <th style={{ padding: '12px', textAlign: 'center', color: '#888', fontSize: '14px' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.map((item) => (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid #222',
                        opacity: item.isActive ? 1 : 0.5,
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: '14px' }}>{item.code}</td>
                      <td style={{ padding: '12px', fontSize: '14px' }}>{item.name}</td>
                      <td
                        style={{
                          padding: '12px',
                          textAlign: 'right',
                          fontSize: '14px',
                          color: item.currentPrice ? ((item.changePct ?? 0) >= 0 ? '#00ff88' : '#ff4466') : '#666',
                        }}
                      >
                        {item.currentPrice ? (
                          <>
                            {item.currentPrice.toFixed(2)}
                            {item.changePct !== undefined && (
                              <span style={{ fontSize: '12px', marginLeft: '8px' }}>
                                {item.changePct >= 0 ? '+' : ''}
                                {item.changePct.toFixed(2)}%
                              </span>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#666' }}>未更新</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px' }}>
                        {item.idealBuy?.toFixed(2) ?? '--'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px' }}>
                        {item.secondaryBuy?.toFixed(2) ?? '--'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px' }}>
                        {item.stopLoss?.toFixed(2) ?? '--'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px' }}>
                        {item.takeProfit?.toFixed(2) ?? '--'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>
                        {item.distanceToIdeal !== undefined && (
                          <div
                            style={{
                              fontSize: '12px',
                              color: getDistanceColor(item.distanceToIdeal),
                            }}
                          >
                            买 {formatDistance(item.distanceToIdeal)}
                          </div>
                        )}
                        {item.distanceToStop !== undefined && (
                          <div
                            style={{
                              fontSize: '12px',
                              color: getDistanceColor(item.distanceToStop),
                            }}
                          >
                            损 {formatDistance(item.distanceToStop)}
                          </div>
                        )}
                        {item.distanceToTarget !== undefined && (
                          <div
                            style={{
                              fontSize: '12px',
                              color: getDistanceColor(item.distanceToTarget),
                            }}
                          >
                            利 {formatDistance(item.distanceToTarget)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          {(item.triggeredTypes ?? []).map((type) => {
                            const config = TRIGGER_TYPE_LABELS[type as keyof typeof TRIGGER_TYPE_LABELS];
                            return (
                              <span
                                key={type}
                                style={{
                                  padding: '2px 8px',
                                  background: config ? `${config.color}20` : '#333',
                                  border: `1px solid ${config?.color ?? '#666'}`,
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  color: config?.color ?? '#fff',
                                }}
                              >
                                {config?.emoji} {config?.label}
                              </span>
                            );
                          })}
                          {(item.triggeredTypes ?? []).length === 0 && (
                            <span style={{ fontSize: '12px', color: '#888' }}>监控中</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button
                            onClick={() => handleToggleItem(item.id)}
                            style={{
                              padding: '4px 8px',
                              background: item.isActive ? 'rgba(255, 68, 102, 0.1)' : 'rgba(0, 255, 136, 0.1)',
                              border: `1px solid ${item.isActive ? '#ff4466' : '#00ff88'}`,
                              borderRadius: '4px',
                              fontSize: '11px',
                              color: item.isActive ? '#ff4466' : '#00ff88',
                              cursor: 'pointer',
                            }}
                          >
                            {item.isActive ? '暂停' : '启用'}
                          </button>
                          <button
                            onClick={() =>
                              setItemDialog({
                                open: true,
                                editing: item,
                                code: item.code,
                                name: item.name,
                                idealBuy: item.idealBuy?.toString() ?? '',
                                secondaryBuy: item.secondaryBuy?.toString() ?? '',
                                stopLoss: item.stopLoss?.toString() ?? '',
                                takeProfit: item.takeProfit?.toString() ?? '',
                              })
                            }
                            style={{
                              padding: '4px 8px',
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px solid #333',
                              borderRadius: '4px',
                              fontSize: '11px',
                              color: '#888',
                              cursor: 'pointer',
                            }}
                          >
                            编辑
                          </button>
                          <button
                            onClick={() =>
                              setDeleteConfirm({
                                open: true,
                                type: 'item',
                                id: item.id,
                                name: `${item.name} (${item.code})`,
                              })
                            }
                            style={{
                              padding: '4px 8px',
                              background: 'rgba(255, 68, 102, 0.1)',
                              border: '1px solid rgba(255, 68, 102, 0.3)',
                              borderRadius: '4px',
                              fontSize: '11px',
                              color: '#ff4466',
                              cursor: 'pointer',
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {snapshot.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        style={{
                          padding: '40px',
                          textAlign: 'center',
                          color: '#666',
                          fontSize: '14px',
                        }}
                      >
                        暂无监控项，点击"添加股票"开始监控
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* 告警历史 Tab */}
      {activeTab === 'alerts' && (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#888', fontSize: '14px' }}>时间</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#888', fontSize: '14px' }}>股票</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: '#888', fontSize: '14px' }}>触发类型</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: '#888', fontSize: '14px' }}>触发价格</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: '#888', fontSize: '14px' }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => {
                  const config = TRIGGER_TYPE_LABELS[alert.triggerType as keyof typeof TRIGGER_TYPE_LABELS];
                  return (
                    <tr key={alert.id} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: '12px', fontSize: '14px', color: '#888' }}>
                        {new Date(alert.alertTime).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px', fontSize: '14px' }}>
                        {alert.name} ({alert.code})
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            padding: '4px 12px',
                            background: config ? `${config.color}20` : '#333',
                            border: `1px solid ${config?.color ?? '#666'}`,
                            borderRadius: '4px',
                            fontSize: '12px',
                            color: config?.color ?? '#fff',
                          }}
                        >
                          {config?.emoji} {config?.label}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px' }}>
                        {alert.triggerPrice.toFixed(2)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        {alert.isSent ? (
                          <span style={{ color: '#00ff88', fontSize: '12px' }}>已通知</span>
                        ) : (
                          <span style={{ color: '#ffaa00', fontSize: '12px' }}>待发送</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {alerts.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: '40px',
                        textAlign: 'center',
                        color: '#666',
                        fontSize: '14px',
                      }}
                    >
                      暂无告警记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 组编辑弹窗 */}
      {groupDialog.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setGroupDialog((d) => ({ ...d, open: false }))}
        >
          <div
            style={{
              background: '#1a1a2e',
              padding: '24px',
              borderRadius: '8px',
              width: '400px',
              border: '1px solid #333',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 20px 0', color: '#fff' }}>
              {groupDialog.editing ? '编辑监控组' : '新建监控组'}
            </h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                组名称 *
              </label>
              <input
                type="text"
                value={groupDialog.name}
                onChange={(e) => setGroupDialog((d) => ({ ...d, name: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#0f0f1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
                placeholder="例如：自选股、短线股"
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                描述
              </label>
              <input
                type="text"
                value={groupDialog.description}
                onChange={(e) => setGroupDialog((d) => ({ ...d, description: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#0f0f1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
                placeholder="可选描述"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setGroupDialog((d) => ({ ...d, open: false }))}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#888',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleSaveGroup}
                disabled={!groupDialog.name.trim()}
                style={{
                  padding: '10px 20px',
                  background: '#00d4ff',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#000',
                  cursor: groupDialog.name.trim() ? 'pointer' : 'not-allowed',
                  opacity: groupDialog.name.trim() ? 1 : 0.6,
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 监控项编辑弹窗 */}
      {itemDialog.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setItemDialog((d) => ({ ...d, open: false }))}
        >
          <div
            style={{
              background: '#1a1a2e',
              padding: '24px',
              borderRadius: '8px',
              width: '450px',
              border: '1px solid #333',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 20px 0', color: '#fff' }}>
              {itemDialog.editing ? '编辑监控项' : '添加监控股票'}
            </h3>

            {!itemDialog.editing && (
              <>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                    股票代码 *
                  </label>
                  <input
                    type="text"
                    value={itemDialog.code}
                    onChange={(e) => setItemDialog((d) => ({ ...d, code: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: '#0f0f1a',
                      border: '1px solid #333',
                      borderRadius: '4px',
                      color: '#fff',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                    placeholder="例如：000001、600519"
                  />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                    股票名称
                  </label>
                  <input
                    type="text"
                    value={itemDialog.name}
                    onChange={(e) => setItemDialog((d) => ({ ...d, name: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: '#0f0f1a',
                      border: '1px solid #333',
                      borderRadius: '4px',
                      color: '#fff',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                    placeholder="可选，留空自动获取"
                  />
                </div>
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                  理想买入点
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={itemDialog.idealBuy}
                  onChange={(e) => setItemDialog((d) => ({ ...d, idealBuy: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#0f0f1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                  placeholder="价格"
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                  次选买入点
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={itemDialog.secondaryBuy}
                  onChange={(e) => setItemDialog((d) => ({ ...d, secondaryBuy: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#0f0f1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                  placeholder="价格"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <div>
                <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                  止损点
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={itemDialog.stopLoss}
                  onChange={(e) => setItemDialog((d) => ({ ...d, stopLoss: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#0f0f1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                  placeholder="价格"
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#888', fontSize: '14px', marginBottom: '8px' }}>
                  目标点
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={itemDialog.takeProfit}
                  onChange={(e) => setItemDialog((d) => ({ ...d, takeProfit: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#0f0f1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                  placeholder="价格"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setItemDialog((d) => ({ ...d, open: false }))}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: '#888',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handleSaveItem}
                disabled={itemDialog.editing ? false : !itemDialog.code.trim()}
                style={{
                  padding: '10px 20px',
                  background: '#00d4ff',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#000',
                  cursor: itemDialog.editing || itemDialog.code.trim() ? 'pointer' : 'not-allowed',
                  opacity: itemDialog.editing || itemDialog.code.trim() ? 1 : 0.6,
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        isOpen={deleteConfirm.open}
        title={deleteConfirm.type === 'group' ? '删除监控组' : '删除监控项'}
        message={`确定要删除${deleteConfirm.type === 'group' ? '监控组' : ''} "${deleteConfirm.name}" 吗？此操作不可撤销。`}
        confirmText="删除"
        cancelText="取消"
        isDanger
        onConfirm={deleteConfirm.type === 'group' ? handleDeleteGroup : handleDeleteItem}
        onCancel={() => setDeleteConfirm({ open: false, type: 'group', id: 0, name: '' })}
      />
    </div>
  );
}
