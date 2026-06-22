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
import { Banner, Button, Form, Row, Col, Spin } from '@douyinfe/semi-ui';
import {
  API,
  removeTrailingSlash,
  showError,
  showSuccess,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';

export default function SettingsPaymentGateway(props) {
  const { t } = useTranslation();
  const gateway = props.gateway || 'epay';
  const isAlipay = gateway === 'alipay';
  const sectionTitle = props.hideSectionTitle
    ? undefined
    : isAlipay
      ? t('支付宝原生设置')
      : t('易支付设置');
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    PayAddress: '',
    EpayId: '',
    EpayKey: '',
    AlipayAppId: '',
    AlipayPrivateKey: '',
    AlipayPublicKey: '',
    AlipayProduction: false,
  });
  const formApiRef = useRef(null);

  useEffect(() => {
    if (props.options && formApiRef.current) {
      const currentInputs = {
        PayAddress: props.options.PayAddress || '',
        EpayId: props.options.EpayId || '',
        EpayKey: props.options.EpayKey || '',
        AlipayAppId: props.options.AlipayAppId || '',
        AlipayPrivateKey: props.options.AlipayPrivateKey || '',
        AlipayPublicKey: props.options.AlipayPublicKey || '',
        AlipayProduction: props.options.AlipayProduction === 'true',
      };

      setInputs(currentInputs);
      formApiRef.current.setValues(currentInputs);
    }
  }, [props.options]);

  const handleFormChange = (values) => {
    setInputs(values);
  };

  const submitPaymentGatewaySettings = async () => {
    if (props.options.ServerAddress === '') {
      showError(t('请先填写服务器地址'));
      return;
    }

    setLoading(true);
    try {
      const options = [];

      if (isAlipay) {
        if (inputs.AlipayAppId !== '') {
          options.push({ key: 'AlipayAppId', value: inputs.AlipayAppId });
        }
        if (inputs.AlipayPrivateKey !== '') {
          options.push({ key: 'AlipayPrivateKey', value: inputs.AlipayPrivateKey });
        }
        if (inputs.AlipayPublicKey !== '') {
          options.push({ key: 'AlipayPublicKey', value: inputs.AlipayPublicKey });
        }
        options.push({ key: 'AlipayProduction', value: inputs.AlipayProduction ? 'true' : 'false' });
      } else {
        options.push({ key: 'PayAddress', value: removeTrailingSlash(inputs.PayAddress) });
        if (inputs.EpayId !== '') {
          options.push({ key: 'EpayId', value: inputs.EpayId });
        }
        if (inputs.EpayKey !== undefined && inputs.EpayKey !== '') {
          options.push({ key: 'EpayKey', value: inputs.EpayKey });
        }
      }

      const requestQueue = options.map((opt) =>
        API.put('/api/option/', {
          key: opt.key,
          value: opt.value,
        }),
      );

      const results = await Promise.all(requestQueue);

      const errorResults = results.filter((res) => !res.data.success);
      if (errorResults.length > 0) {
        errorResults.forEach((res) => {
          showError(res.data.message);
        });
      } else {
        showSuccess(t('更新成功'));
        props.refresh && props.refresh();
      }
    } catch (error) {
      showError(t('更新失败'));
    }
    setLoading(false);
  };

  return (
    <Spin spinning={loading}>
      <Form
        initValues={inputs}
        onValueChange={handleFormChange}
        getFormApi={(api) => (formApiRef.current = api)}
      >
        <Form.Section text={sectionTitle}>
          {!isAlipay ? (
            <>
            <Banner
              type='info'
              icon={<Info size={16} />}
              description={t('仅用于易支付渠道。支付宝原生支付在独立的支付宝原生设置中配置。')}
              style={{ marginBottom: 16 }}
            />
            <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}>
              <Col xs={24} sm={24} md={8} lg={8} xl={8}>
                <Form.Input
                  field='PayAddress'
                  label={t('易支付接口地址')}
                  placeholder={t('例如：https://yourdomain.com')}
                />
              </Col>
              <Col xs={24} sm={24} md={8} lg={8} xl={8}>
                <Form.Input
                  field='EpayId'
                  label={t('易支付商户 ID')}
                  placeholder={t('例如：0001')}
                />
              </Col>
              <Col xs={24} sm={24} md={8} lg={8} xl={8}>
                <Form.Input
                  field='EpayKey'
                  label={t('易支付 API 密钥')}
                  placeholder={t('敏感信息不会发送到前端显示')}
                  type='password'
                />
              </Col>
            </Row>
            </>
          ) : (
            <>
            <Banner
              type='info'
              icon={<Info size={16} />}
              description={t('填写支付宝开放平台应用参数，启用后用户可直接跳转支付宝官方收银台。')}
              style={{ marginBottom: 16 }}
            />
            <Row gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}>
              <Col xs={24} sm={24} md={8} lg={8} xl={8}>
                <Form.Input
                  field='AlipayAppId'
                  label={t('支付宝 App ID')}
                  placeholder={t('例如：2021000000000000')}
                />
              </Col>
              <Col xs={24} sm={24} md={8} lg={8} xl={8}>
                <Form.Input
                  field='AlipayPrivateKey'
                  label={t('应用私钥 (RSA2)')}
                  placeholder={t('敏感信息不会发送到前端显示')}
                  type='password'
                />
              </Col>
              <Col xs={24} sm={24} md={8} lg={8} xl={8}>
                <Form.Input
                  field='AlipayPublicKey'
                  label={t('支付宝公钥')}
                  placeholder={t('支付宝开放平台生成的公钥')}
                  type='password'
                />
              </Col>
            </Row>
            <Row
              gutter={{ xs: 8, sm: 16, md: 24, lg: 24, xl: 24, xxl: 24 }}
              style={{ marginTop: 12 }}
            >
              <Col xs={24} sm={24} md={12} lg={12} xl={12}>
                <Form.Switch
                  field='AlipayProduction'
                  label={t('生产模式（关闭为沙箱模式）')}
                />
              </Col>
            </Row>
            </>
          )}

          <Button onClick={submitPaymentGatewaySettings} style={{ marginTop: 16 }}>
            {isAlipay ? t('更新支付宝原生设置') : t('更新易支付设置')}
          </Button>
        </Form.Section>
      </Form>
    </Spin>
  );
}
