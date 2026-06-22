/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useState, useRef } from 'react';
import {
  Button,
  Col,
  Form,
  Row,
  Spin,
  Banner,
  Tag,
  Divider,
} from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  verifyJSON,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

const thinkingExample = JSON.stringify(
  ['moonshotai/kimi-k2-thinking', 'kimi-k2-thinking'],
  null,
  2,
);

const chatCompletionsToResponsesPolicyExample = JSON.stringify(
  {
    enabled: true,
    all_channels: false,
    channel_ids: [1, 2],
    channel_types: [1],
    model_patterns: ['^gpt-4o.*$', '^gpt-5.*$'],
  },
  null,
  2,
);

const chatCompletionsToResponsesPolicyAllChannelsExample = JSON.stringify(
  {
    enabled: true,
    all_channels: true,
    model_patterns: ['^gpt-4o.*$', '^gpt-5.*$'],
  },
  null,
  2,
);

const imageGenerationInjectionPolicyExample = JSON.stringify(
  {
    enabled: true,
    all_channels: true,
    model_patterns: ['gpt-5.5*', 'gpt-5.4*'],
    unsupported_models: ['gpt-image-*'],
    default_output_format: 'png',
    default_size: '1024x1024',
    default_quality: 'high',
  },
  null,
  2,
);

const defaultGlobalSettingInputs = {
  'global.pass_through_request_enabled': false,
  'global.thinking_model_blacklist': '[]',
  'global.chat_completions_to_responses_policy': '{}',
  'global.image_generation_injection_policy': '{}',
  'general_setting.ping_interval_enabled': false,
  'general_setting.ping_interval_seconds': 60,
};

export default function SettingGlobalModel(props) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState(defaultGlobalSettingInputs);
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(defaultGlobalSettingInputs);
  const chatCompletionsToResponsesPolicyKey =
    'global.chat_completions_to_responses_policy';
  const imageGenerationInjectionPolicyKey =
    'global.image_generation_injection_policy';

  const setChatCompletionsToResponsesPolicyValue = (value) => {
    setInputs((prev) => ({
      ...prev,
      [chatCompletionsToResponsesPolicyKey]: value,
    }));
    if (refForm.current) {
      refForm.current.setValue(chatCompletionsToResponsesPolicyKey, value);
    }
  };

  const setImageGenerationInjectionPolicyValue = (value) => {
    setInputs((prev) => ({
      ...prev,
      [imageGenerationInjectionPolicyKey]: value,
    }));
    if (refForm.current) {
      refForm.current.setValue(imageGenerationInjectionPolicyKey, value);
    }
  };

  const normalizeValueBeforeSave = (key, value) => {
    if (key === 'global.thinking_model_blacklist') {
      const text = typeof value === 'string' ? value.trim() : '';
      return text === '' ? '[]' : value;
    }
    if (key === 'global.chat_completions_to_responses_policy') {
      const text = typeof value === 'string' ? value.trim() : '';
      return text === '' ? '{}' : value;
    }
    if (key === 'global.image_generation_injection_policy') {
      const text = typeof value === 'string' ? value.trim() : '';
      return text === '' ? '{}' : value;
    }
    return value;
  };

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) => {
      const normalizedValue = normalizeValueBeforeSave(
        item.key,
        inputs[item.key],
      );
      let value = String(normalizedValue);

      return API.put('/api/option/', {
        key: item.key,
        value,
      });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (requestQueue.length === 1) {
          if (res.includes(undefined)) return;
        } else if (requestQueue.length > 1) {
          if (res.includes(undefined))
            return showError(t('部分保存失败，请重试'));
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => {
        showError(t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    const currentInputs = {};
    for (const key of Object.keys(defaultGlobalSettingInputs)) {
      if (props.options[key] !== undefined) {
        let value = props.options[key];
        if (key === 'global.thinking_model_blacklist') {
          try {
            value =
              value && String(value).trim() !== ''
                ? JSON.stringify(JSON.parse(value), null, 2)
                : defaultGlobalSettingInputs[key];
          } catch (error) {
            value = defaultGlobalSettingInputs[key];
          }
        }
        if (key === 'global.chat_completions_to_responses_policy') {
          try {
            value =
              value && String(value).trim() !== ''
                ? JSON.stringify(JSON.parse(value), null, 2)
                : defaultGlobalSettingInputs[key];
          } catch (error) {
            value = defaultGlobalSettingInputs[key];
          }
        }
        if (key === 'global.image_generation_injection_policy') {
          try {
            value =
              value && String(value).trim() !== ''
                ? JSON.stringify(JSON.parse(value), null, 2)
                : defaultGlobalSettingInputs[key];
          } catch (error) {
            value = defaultGlobalSettingInputs[key];
          }
        }
        currentInputs[key] = value;
      } else {
        currentInputs[key] = defaultGlobalSettingInputs[key];
      }
    }

    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    if (refForm.current) {
      refForm.current.setValues(currentInputs);
    }
  }, [props.options]);

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('全局设置')}>
            <Row>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  label={t('启用请求透传')}
                  field={'global.pass_through_request_enabled'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'global.pass_through_request_enabled': value,
                    })
                  }
                  extraText={t(
                    '开启后，所有请求将直接透传给上游，不会进行任何处理（重定向和渠道适配也将失效）,请谨慎开启',
                  )}
                />
              </Col>
            </Row>
            <Row>
              <Col span={24}>
                <Form.TextArea
                  label={t('不自动处理思考后缀的模型列表')}
                  field={'global.thinking_model_blacklist'}
                  placeholder={t('例如：') + '\n' + thinkingExample}
                  rows={4}
                  rules={[
                    {
                      validator: (rule, value) => {
                        if (!value || value.trim() === '') return true;
                        return verifyJSON(value);
                      },
                      message: t('不是合法的 JSON 字符串'),
                    },
                  ]}
                  extraText={t(
                    '列出的模型将不会自动添加或移除-thinking/-nothinking 后缀',
                  )}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'global.thinking_model_blacklist': value,
                    })
                  }
                />
              </Col>
            </Row>

            <Form.Section
              text={
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  {t('ChatCompletions→Responses 兼容配置')}
                  <Tag color='orange' size='small'>
                    测试版
                  </Tag>
                </span>
              }
            >
              <Row style={{ marginTop: 10 }}>
                <Col span={24}>
                  <Banner
                    type='warning'
                    description={t(
                      '提示：该功能为测试版，未来配置结构与功能行为可能发生变更，请勿在生产环境使用。',
                    )}
                  />
                </Col>
              </Row>

              <Row style={{ marginTop: 10 }}>
                <Col span={24}>
                  <Form.TextArea
                    label={t('参数配置')}
                    field={chatCompletionsToResponsesPolicyKey}
                    placeholder={
                      t('例如（指定渠道）：') +
                      '\n' +
                      chatCompletionsToResponsesPolicyExample +
                      '\n\n' +
                      t('例如（全渠道）：') +
                      '\n' +
                      chatCompletionsToResponsesPolicyAllChannelsExample
                    }
                    rows={8}
                    rules={[
                      {
                        validator: (rule, value) => {
                          if (!value || value.trim() === '') return true;
                          return verifyJSON(value);
                        },
                        message: t('不是合法的 JSON 字符串'),
                      },
                    ]}
                    onChange={(value) =>
                      setInputs((prev) => ({
                        ...prev,
                        [chatCompletionsToResponsesPolicyKey]: value,
                      }))
                    }
                  />
                </Col>
              </Row>

              <Row style={{ marginTop: 10, marginBottom: 16 }}>
                <Col span={24}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <Button
                      type='secondary'
                      size='small'
                      onClick={() =>
                        setChatCompletionsToResponsesPolicyValue(
                          chatCompletionsToResponsesPolicyExample,
                        )
                      }
                    >
                      {t('填充模板（指定渠道）')}
                    </Button>
                    <Button
                      type='secondary'
                      size='small'
                      onClick={() =>
                        setChatCompletionsToResponsesPolicyValue(
                          chatCompletionsToResponsesPolicyAllChannelsExample,
                        )
                      }
                    >
                      {t('填充模板（全渠道）')}
                    </Button>
                    <Button
                      type='secondary'
                      size='small'
                      onClick={() => {
                        const raw = inputs[chatCompletionsToResponsesPolicyKey];
                        if (!raw || String(raw).trim() === '') return;
                        try {
                          const formatted = JSON.stringify(
                            JSON.parse(raw),
                            null,
                            2,
                          );
                          setChatCompletionsToResponsesPolicyValue(formatted);
                        } catch (error) {
                          showError(t('不是合法的 JSON 字符串'));
                        }
                      }}
                    >
                      {t('格式化 JSON')}
                    </Button>
                  </div>
                </Col>
              </Row>
            </Form.Section>

            <Form.Section
              text={
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {t('图像生成工具注入策略')}
                </span>
              }
            >
              <Row style={{ marginTop: 10 }}>
                <Col span={24}>
                  <Banner
                    type='info'
                    description={t(
                      '为命中策略的文本模型自动注入 Responses 原生 image_generation 工具与 system 引导，使纯文本模型可在同一请求内闭环完成文生图。默认关闭，仅 OpenAI Responses 兼容渠道生效；纯图模型（gpt-image-*）会自动跳过。优先级：模型级 > 渠道级 > 全局。',
                    )}
                  />
                </Col>
              </Row>
              <Row>
                <Col span={24}>
                  <Form.TextArea
                    label={t('图像生成工具注入策略（JSON）')}
                    field={imageGenerationInjectionPolicyKey}
                    placeholder={t(
                      '留空则不启用。示例已提供，可通过下方按钮填充模板。',
                    )}
                    rows={10}
                    rules={[
                      {
                        validator: (rule, value) => {
                          if (!value || value.trim() === '') return true;
                          return verifyJSON(value);
                        },
                        message: t('不是合法的 JSON 字符串'),
                      },
                    ]}
                    onChange={(value) =>
                      setInputs((prev) => ({
                        ...prev,
                        [imageGenerationInjectionPolicyKey]: value,
                      }))
                    }
                  />
                </Col>
              </Row>
              <Row style={{ marginTop: 10, marginBottom: 16 }}>
                <Col span={24}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <Button
                      type='secondary'
                      size='small'
                      onClick={() =>
                        setImageGenerationInjectionPolicyValue(
                          imageGenerationInjectionPolicyExample,
                        )
                      }
                    >
                      {t('填充示例策略')}
                    </Button>
                    <Button
                      type='secondary'
                      size='small'
                      onClick={() => {
                        const raw = inputs[imageGenerationInjectionPolicyKey];
                        if (!raw || String(raw).trim() === '') return;
                        try {
                          const formatted = JSON.stringify(
                            JSON.parse(raw),
                            null,
                            2,
                          );
                          setImageGenerationInjectionPolicyValue(formatted);
                        } catch (error) {
                          showError(t('不是合法的 JSON 字符串'));
                        }
                      }}
                    >
                      {t('格式化 JSON')}
                    </Button>
                  </div>
                </Col>
              </Row>
            </Form.Section>

            <Form.Section
              text={
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {t('连接保活设置')}
                </span>
              }
            >
              <Row style={{ marginTop: 10 }}>
                <Col span={24}>
                  <Banner
                    type='warning'
                    description={t(
                      '警告：启用保活后，如果已经写入保活数据后渠道出错，系统无法重试，如果必须开启，推荐设置尽可能大的Ping间隔',
                    )}
                  />
                </Col>
              </Row>
              <Row>
                <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                  <Form.Switch
                    label={t('启用Ping间隔')}
                    field={'general_setting.ping_interval_enabled'}
                    onChange={(value) =>
                      setInputs({
                        ...inputs,
                        'general_setting.ping_interval_enabled': value,
                      })
                    }
                    extraText={t('开启后，将定期发送ping数据保持连接活跃')}
                  />
                </Col>
                <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                  <Form.InputNumber
                    label={t('Ping间隔（秒）')}
                    field={'general_setting.ping_interval_seconds'}
                    onChange={(value) =>
                      setInputs({
                        ...inputs,
                        'general_setting.ping_interval_seconds': value,
                      })
                    }
                    min={1}
                    disabled={!inputs['general_setting.ping_interval_enabled']}
                  />
                </Col>
              </Row>
            </Form.Section>

            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
