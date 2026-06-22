import React, { useState, useEffect, useContext } from 'react';
import { API } from '../../helpers';
import { StatusContext } from '../../context/Status';
import { theme } from './theme/design';
import { Table, Tag, Input, Button } from '@douyinfe/semi-ui';

const ModelDistribution = () => {
  const [statusState] = useContext(StatusContext);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    API.get('/api/pricing')
      .then((res) => {
        if (res?.data?.success) {
          setModels(res.data.data || []);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredModels = models.filter((m) =>
    m.model_name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const columns = [
    {
      title: '模型标识',
      dataIndex: 'model_name',
      key: 'model_name',
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>
            {record.channel_type === 1
              ? '🔵'
              : record.channel_type === 14
                ? '🟣'
                : record.channel_type === 24
                  ? '🔴'
                  : '🟢'}
          </span>
          <span style={{ ...theme.typography.body, fontWeight: 600 }}>
            {text}
          </span>
          {record.tags &&
            (Array.isArray(record.tags) ? record.tags : [record.tags]).map(
              (tag, i) => (
                <Tag
                  key={i}
                  size='small'
                  color='blue'
                  style={{ borderRadius: theme.radius.sm }}
                >
                  {tag}
                </Tag>
              ),
            )}
        </div>
      ),
    },
    {
      title: '输入费率',
      dataIndex: 'model_ratio',
      key: 'model_ratio',
      render: (text) => (
        <span style={{ fontFamily: 'monospace', ...theme.typography.small }}>
          ${(text * 2).toFixed(4)} / 1M
        </span>
      ),
    },
    {
      title: '补全费率',
      dataIndex: 'completion_ratio',
      key: 'completion_ratio',
      render: (text, record) => (
        <span style={{ fontFamily: 'monospace', ...theme.typography.small }}>
          ${(record.model_ratio * text * 2).toFixed(4)} / 1M
        </span>
      ),
    },
    {
      title: '可用分组',
      dataIndex: 'enable_groups',
      key: 'enable_groups',
      render: (groups) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(Array.isArray(groups) ? groups : groups ? [groups] : []).map(
            (g) => (
              <Tag
                key={g}
                size='small'
                style={{
                  background: theme.colors.background.secondary,
                  border: `1px solid ${theme.colors.border.default}`,
                  color: theme.colors.text.body,
                }}
              >
                {g}
              </Tag>
            ),
          )}
        </div>
      ),
    },
  ];

  return (
    <section
      style={{
        padding: theme.layout.sectionPadding,
        background: theme.colors.background.surface,
      }}
    >
      <div style={{ maxWidth: theme.layout.maxWidth, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ ...theme.typography.h2, margin: '0 0 16px' }}>
            支持百余款主流大模型
          </h2>
          <p style={{ ...theme.typography.subtitle, margin: '0' }}>
            无需科学上网，一个账号、一个接口调用全网模型资源
          </p>
        </div>

        <div
          style={{
            background: theme.colors.background.primary,
            padding: 32,
            borderRadius: theme.radius.xl,
            border: `1px solid ${theme.colors.border.default}`,
            boxShadow: theme.shadows.sm,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 24,
            }}
          >
            <h3 style={{ ...theme.typography.h3, margin: 0 }}>
              支持的模型列表
            </h3>
            <div style={{ width: 300 }}>
              <Input
                placeholder='搜索模型，如 gpt-4o, claude-3-opus...'
                value={searchQuery}
                onChange={(v) => setSearchQuery(v)}
                style={{ height: 40, borderRadius: theme.radius.md }}
              />
            </div>
          </div>

          <Table
            columns={columns}
            dataSource={filteredModels}
            loading={loading}
            pagination={{ pageSize: 15 }}
            size='middle'
            rowKey='model_name'
            empty={
              <div
                style={{
                  padding: 48,
                  textAlign: 'center',
                  color: theme.colors.text.muted,
                }}
              >
                无匹配的模型结果
              </div>
            }
          />
        </div>
      </div>
    </section>
  );
};

export default ModelDistribution;
