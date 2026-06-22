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

import React from 'react';
import {
  Card,
  Select,
  Typography,
  Button,
  Switch,
  InputNumber,
  Collapsible,
} from '@douyinfe/semi-ui';
import {
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Sparkles,
  Users,
  ToggleLeft,
  X,
  Settings,
  SlidersHorizontal,
  Code2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderGroupOption, selectFilter } from '../../helpers';
import ParameterControl from './ParameterControl';
import ImageUrlInput from './ImageUrlInput';
import ConfigManager from './ConfigManager';
import CustomRequestEditor from './CustomRequestEditor';

const SettingsPanel = ({
  inputs,
  parameterEnabled,
  models,
  groups,
  styleState,
  showDebugPanel,
  customRequestMode,
  customRequestBody,
  onInputChange,
  onParameterToggle,
  onCloseSettings,
  onConfigImport,
  onConfigReset,
  onCustomRequestModeChange,
  onCustomRequestBodyChange,
  previewPayload,
  messages,
  canGenerateImage,
  canEditImage,
}) => {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [developerOpen, setDeveloperOpen] = React.useState(false);

  const imageSizeOptions = [
    { label: t('正方形'), value: '1024x1024' },
    { label: t('横图'), value: '1536x1024' },
    { label: t('竖图'), value: '1024x1536' },
    { label: t('自动'), value: 'auto' },
  ];
  const imageQualityOptions = [
    { label: t('自动'), value: 'auto' },
    { label: t('标准'), value: 'standard' },
    { label: t('高清'), value: 'hd' },
    { label: t('低'), value: 'low' },
    { label: t('中'), value: 'medium' },
    { label: t('高'), value: 'high' },
  ];

  const currentConfig = {
    inputs,
    parameterEnabled,
    showDebugPanel,
    customRequestMode,
    customRequestBody,
  };

  return (
    <Card
      className='h-full flex flex-col'
      bordered={false}
      bodyStyle={{
        padding: styleState.isMobile ? '16px' : '24px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 标题区域 - 与调试面板保持一致 */}
      <div className='flex items-center justify-between mb-6 flex-shrink-0'>
        <div className='flex items-center'>
          <div className='w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center mr-3'>
            <Settings size={20} className='text-white' />
          </div>
          <Typography.Title heading={5} className='mb-0'>
            {t('模型配置')}
          </Typography.Title>
        </div>

        {styleState.isMobile && onCloseSettings && (
          <Button
            icon={<X size={16} />}
            onClick={onCloseSettings}
            theme='borderless'
            type='tertiary'
            size='small'
            className='!rounded-lg'
          />
        )}
      </div>

      {/* 移动端配置管理 */}
      {styleState.isMobile && (
        <div className='mb-4 flex-shrink-0'>
          <ConfigManager
            currentConfig={currentConfig}
            onConfigImport={onConfigImport}
            onConfigReset={onConfigReset}
            styleState={{ ...styleState, isMobile: false }}
            messages={messages}
          />
        </div>
      )}

      <div className='space-y-5 overflow-y-auto flex-1 pr-2 model-settings-scroll'>
        {/* 分组选择 */}
        <div className={customRequestMode ? 'opacity-50' : ''}>
          <div className='flex items-center gap-2 mb-2'>
            <Users size={16} className='text-semi-color-text-2' />
            <Typography.Text strong className='text-sm'>
              {t('分组')}
            </Typography.Text>
            {customRequestMode && (
              <Typography.Text className='text-xs text-orange-600'>
                ({t('已在自定义模式中忽略')})
              </Typography.Text>
            )}
          </div>
          <Select
            placeholder={t('请选择分组')}
            name='group'
            required
            selection
            filter={selectFilter}
            autoClearSearchValue={false}
            onChange={(value) => onInputChange('group', value)}
            value={inputs.group}
            autoComplete='new-password'
            optionList={groups}
            renderOptionItem={renderGroupOption}
            style={{ width: '100%' }}
            dropdownStyle={{ width: '100%', maxWidth: '100%' }}
            className='!rounded-lg'
            disabled={customRequestMode}
          />
        </div>

        {/* 模型选择 */}
        <div className={customRequestMode ? 'opacity-50' : ''}>
          <div className='flex items-center gap-2 mb-2'>
            <Sparkles size={16} className='text-semi-color-text-2' />
            <Typography.Text strong className='text-sm'>
              {t('模型')}
            </Typography.Text>
            {customRequestMode && (
              <Typography.Text className='text-xs text-orange-600'>
                ({t('已在自定义模式中忽略')})
              </Typography.Text>
            )}
          </div>
          <Select
            placeholder={t('请选择模型')}
            name='model'
            required
            selection
            filter={selectFilter}
            autoClearSearchValue={false}
            onChange={(value) => onInputChange('model', value)}
            value={inputs.model}
            autoComplete='new-password'
            optionList={models}
            style={{ width: '100%' }}
            dropdownStyle={{ width: '100%', maxWidth: '100%' }}
            className='!rounded-lg'
            disabled={customRequestMode}
          />
        </div>

        <div>
          <Button
            block
            theme='borderless'
            type='tertiary'
            onClick={() => setAdvancedOpen((open) => !open)}
            icon={
              advancedOpen ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )
            }
            className='!justify-start !rounded-lg'
          >
            <span className='inline-flex items-center gap-2'>
              <SlidersHorizontal size={16} />
              {t('高级设置')}
            </span>
          </Button>
          <Collapsible isOpen={advancedOpen}>
            <div className='space-y-5 pt-4'>
              <div className={customRequestMode ? 'opacity-50' : ''}>
                <ImageUrlInput
                  imageUrls={inputs.imageUrls}
                  imageEnabled={canEditImage || inputs.imageEnabled}
                  onImageUrlsChange={(urls) => onInputChange('imageUrls', urls)}
                  onImageEnabledChange={(enabled) =>
                    onInputChange('imageEnabled', enabled)
                  }
                  disabled={customRequestMode}
                  hideSwitch={canEditImage}
                  referenceMode={canEditImage}
                  title={canEditImage ? t('参考图') : t('图片地址')}
                  description={
                    canEditImage
                      ? t('上传或粘贴参考图后，生成时会自动参考这些图片')
                      : undefined
                  }
                />
              </div>

              {canGenerateImage && (
                <div className='space-y-3'>
                  <div className='flex items-center gap-2'>
                    <ImagePlus size={16} className='text-semi-color-text-2' />
                    <Typography.Text strong className='text-sm'>
                      {t('图片参数')}
                    </Typography.Text>
                  </div>
                  <div className='grid grid-cols-2 gap-3'>
                    <div>
                      <Typography.Text strong className='text-sm block mb-2'>
                        {t('图片比例')}
                      </Typography.Text>
                      <Select
                        value={inputs.imageSize || '1024x1024'}
                        onChange={(value) => onInputChange('imageSize', value)}
                        optionList={imageSizeOptions}
                        style={{ width: '100%' }}
                        disabled={customRequestMode}
                      />
                    </div>
                    <div>
                      <Typography.Text strong className='text-sm block mb-2'>
                        {t('质量')}
                      </Typography.Text>
                      <Select
                        value={inputs.imageQuality || 'auto'}
                        onChange={(value) => onInputChange('imageQuality', value)}
                        optionList={imageQualityOptions}
                        style={{ width: '100%' }}
                        disabled={customRequestMode}
                      />
                    </div>
                  </div>
                  <div className='grid grid-cols-2 gap-3'>
                    <div>
                      <Typography.Text strong className='text-sm block mb-2'>
                        {t('生成张数')}
                      </Typography.Text>
                      <InputNumber
                        value={inputs.imageN || 1}
                        min={1}
                        max={10}
                        precision={0}
                        onNumberChange={(value) => onInputChange('imageN', value)}
                        style={{ width: '100%' }}
                        disabled={customRequestMode}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className={customRequestMode ? 'opacity-50' : ''}>
                <ParameterControl
                  inputs={inputs}
                  parameterEnabled={parameterEnabled}
                  onInputChange={onInputChange}
                  onParameterToggle={onParameterToggle}
                  disabled={customRequestMode}
                />
              </div>

              <div className={customRequestMode ? 'opacity-50' : ''}>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <ToggleLeft size={16} className='text-semi-color-text-2' />
                    <Typography.Text strong className='text-sm'>
                      {t('流式输出')}
                    </Typography.Text>
                    {customRequestMode && (
                      <Typography.Text className='text-xs text-orange-600'>
                        ({t('已在自定义模式中忽略')})
                      </Typography.Text>
                    )}
                  </div>
                  <Switch
                    checked={inputs.stream}
                    onChange={(checked) => onInputChange('stream', checked)}
                    checkedText={t('开')}
                    uncheckedText={t('关')}
                    size='small'
                    disabled={customRequestMode}
                  />
                </div>
              </div>
            </div>
          </Collapsible>
        </div>

        <div>
          <Button
            block
            theme='borderless'
            type='tertiary'
            onClick={() => setDeveloperOpen((open) => !open)}
            icon={
              developerOpen ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )
            }
            className='!justify-start !rounded-lg'
          >
            <span className='inline-flex items-center gap-2'>
              <Code2 size={16} />
              {t('开发者调试')}
            </span>
          </Button>
          <Collapsible isOpen={developerOpen}>
            <div className='space-y-4 pt-4'>
              {canGenerateImage && (
                <div>
                  <Typography.Text strong className='text-sm block mb-2'>
                    {t('图片返回格式')}
                  </Typography.Text>
                  <Select
                    value={inputs.imageResponseFormat || 'url'}
                    onChange={(value) => onInputChange('imageResponseFormat', value)}
                    optionList={[
                      { label: 'url', value: 'url' },
                      { label: 'b64_json', value: 'b64_json' },
                    ]}
                    style={{ width: '100%' }}
                    disabled={customRequestMode}
                  />
                </div>
              )}
              <CustomRequestEditor
                customRequestMode={customRequestMode}
                customRequestBody={customRequestBody}
                onCustomRequestModeChange={onCustomRequestModeChange}
                onCustomRequestBodyChange={onCustomRequestBodyChange}
                defaultPayload={previewPayload}
              />
            </div>
          </Collapsible>
        </div>
      </div>

      {/* 桌面端的配置管理放在底部 */}
      {!styleState.isMobile && (
        <div className='flex-shrink-0 pt-3'>
          <ConfigManager
            currentConfig={currentConfig}
            onConfigImport={onConfigImport}
            onConfigReset={onConfigReset}
            styleState={styleState}
            messages={messages}
          />
        </div>
      )}
    </Card>
  );
};

export default SettingsPanel;
