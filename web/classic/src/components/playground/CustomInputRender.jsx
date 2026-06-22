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

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Button, ImagePreview, InputNumber, Select, Toast } from '@douyinfe/semi-ui';
import { Eye, ImagePlus, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlayground } from '../../contexts/PlaygroundContext';

const CustomInputRender = (props) => {
  const { t } = useTranslation();
  const {
    onPasteImage,
    onRemoveImage,
    onImageParamChange,
    imageEnabled,
    imageUrls,
    imageParams,
  } = usePlayground();
  const { detailProps, actionCapabilities, onSendWithAction } = props;
  const { clearContextNode, inputNode, sendNode, onClick } = detailProps;
  const containerRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);

  const handlePaste = useCallback(
    async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = item.getAsFile();

          if (file) {
            try {
              if (!imageEnabled) {
                Toast.warning({
                  content: t('请先在设置中启用图片功能'),
                  duration: 3,
                });
                return;
              }

              const reader = new FileReader();
              reader.onload = (event) => {
                const base64 = event.target.result;

                if (onPasteImage) {
                  onPasteImage(base64);
                  Toast.success({
                    content: t('图片已添加'),
                    duration: 2,
                  });
                } else {
                  Toast.error({
                    content: t('无法添加图片'),
                    duration: 2,
                  });
                }
              };
              reader.onerror = () => {
                console.error('Failed to read image file:', reader.error);
                Toast.error({
                  content: t('粘贴图片失败'),
                  duration: 2,
                });
              };
              reader.readAsDataURL(file);
            } catch (error) {
              console.error('Failed to paste image:', error);
              Toast.error({
                content: t('粘贴图片失败'),
                duration: 2,
              });
            }
          }
          break;
        }
      }
    },
    [onPasteImage, imageEnabled, t],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('paste', handlePaste);
    return () => {
      container.removeEventListener('paste', handlePaste);
    };
  }, [handlePaste]);

  // 清空按钮
  const styledClearNode = clearContextNode
    ? React.cloneElement(clearContextNode, {
        className: `!rounded-full !bg-semi-color-fill-1 hover:!bg-red-500 hover:!text-white flex-shrink-0 transition-all ${clearContextNode.props.className || ''}`,
        style: {
          ...clearContextNode.props.style,
          width: '32px',
          height: '32px',
          minWidth: '32px',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
      })
    : null;

  // 发送按钮
  const styledSendNode = React.cloneElement(sendNode, {
    className: `!rounded-full !bg-purple-500 hover:!bg-purple-600 flex-shrink-0 transition-all ${sendNode.props.className || ''}`,
    style: {
      ...sendNode.props.style,
      width: '32px',
      height: '32px',
      minWidth: '32px',
      padding: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

  const validImageCount = (imageUrls || []).filter(
    (url) => url && url.trim() !== '',
  ).length;
  const validImages = (imageUrls || [])
    .map((url, index) => ({ url, index }))
    .filter((item) => item.url && item.url.trim() !== '');
  const canGenerateImage = actionCapabilities?.canGenerateImage;
  const canEditImage = actionCapabilities?.canEditImage;
  const imageAction = validImageCount > 0 && canEditImage ? 'image_edit' : 'image_generation';
  const imageActionLabel = validImageCount > 0 && canEditImage ? t('参考图生成') : t('生成图片');

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

  const clearComposerInput = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const controls = [
      ...container.querySelectorAll('textarea'),
      ...container.querySelectorAll('input:not([type="file"]):not([readonly])'),
    ];

    controls.forEach((control) => {
      const prototype = Object.getPrototypeOf(control);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(control, '');
      } else {
        control.value = '';
      }
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });

    container.querySelectorAll('[contenteditable="true"]').forEach((editable) => {
      editable.textContent = '';
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
  }, []);

  const handleActionClick = useCallback(
    (event, action) => {
      event.stopPropagation();
      const textarea = containerRef.current?.querySelector('textarea');
      const input = containerRef.current?.querySelector('input');
      const content = textarea?.value || input?.value || '';

      if (!content.trim()) {
        Toast.warning(t('请输入内容'));
        return;
      }

      onSendWithAction?.(content, undefined, action);

      clearComposerInput();
      requestAnimationFrame(clearComposerInput);
    },
    [clearComposerInput, onSendWithAction, t],
  );

  return (
    <div className='p-2 sm:p-4' ref={containerRef}>
      {canGenerateImage && canEditImage && validImages.length > 0 && (
        <div className='mb-2 rounded-xl border border-blue-100 bg-blue-50/60 p-2'>
          <div className='mb-2 flex items-center justify-between gap-2 text-xs text-blue-700'>
            <span>{`${t('已添加')} ${validImages.length} ${t('张参考图片')}`}</span>
            <span className='text-blue-500'>{t('生成时将自动参考这些图片')}</span>
          </div>
          <div className='flex gap-2 overflow-x-auto pb-1 image-list-scroll'>
            {validImages.map(({ url, index }) => (
              <div
                key={`${url.slice(0, 32)}-${index}`}
                className='group relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-white bg-semi-color-bg-0 shadow-sm'
              >
                <img
                  src={url}
                  alt={`${t('参考图')} ${index + 1}`}
                  className='h-full w-full object-cover'
                />
                <div className='absolute inset-0 hidden items-center justify-center gap-1 bg-black/40 group-hover:flex'>
                  <Button
                    icon={<Eye size={12} />}
                    size='small'
                    theme='solid'
                    type='tertiary'
                    onClick={(event) => {
                      event.stopPropagation();
                      setPreviewUrl(url);
                      setPreviewVisible(true);
                    }}
                    className='!h-6 !w-6 !min-w-0 !rounded-full !p-0'
                    title={t('预览')}
                  />
                  <Button
                    icon={<X size={12} />}
                    size='small'
                    theme='solid'
                    type='danger'
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveImage?.(index);
                    }}
                    className='!h-6 !w-6 !min-w-0 !rounded-full !p-0'
                    title={t('删除')}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {canGenerateImage && (
        <div className='mb-2 rounded-xl border border-semi-color-border bg-semi-color-bg-0 p-2 shadow-sm'>
          <div className='mb-2 flex items-center gap-2 text-xs font-medium text-semi-color-text-1'>
            <SlidersHorizontal size={13} />
            <span>{t('图片参数')}</span>
            {canEditImage && validImageCount === 0 && (
              <span className='font-normal text-semi-color-text-3'>
                {t('上传或粘贴参考图后自动参考生成')}
              </span>
            )}
          </div>
          <div className='grid grid-cols-3 gap-2'>
            <Select
              size='small'
              value={imageParams?.imageSize || '1024x1024'}
              optionList={imageSizeOptions}
              onChange={(value) => onImageParamChange?.('imageSize', value)}
              prefix={t('尺寸')}
              style={{ width: '100%' }}
            />
            <Select
              size='small'
              value={imageParams?.imageQuality || 'auto'}
              optionList={imageQualityOptions}
              onChange={(value) => onImageParamChange?.('imageQuality', value)}
              prefix={t('质量')}
              style={{ width: '100%' }}
            />
            <InputNumber
              size='small'
              value={imageParams?.imageN || 1}
              min={1}
              max={4}
              precision={0}
              prefix={t('张数')}
              onNumberChange={(value) => onImageParamChange?.('imageN', value || 1)}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}
      <div
        className='flex flex-wrap items-center gap-2 sm:gap-3 p-2 bg-semi-color-fill-0 rounded-xl sm:rounded-2xl shadow-sm hover:shadow-md transition-shadow'
        style={{ border: '1px solid var(--semi-color-border)' }}
        onClick={onClick}
        title={t('支持 Ctrl+V 粘贴图片')}
      >
        {/* 清空对话按钮 - 左边 */}
        {styledClearNode}
        <div className='min-w-[180px] flex-1'>{inputNode}</div>
        {canGenerateImage && (
          <Button
            icon={<ImagePlus size={15} />}
            onClick={(event) => handleActionClick(event, imageAction)}
            theme='solid'
            type='primary'
            size='small'
            className='!rounded-full flex-shrink-0'
            title={imageActionLabel}
          >
            {imageActionLabel}
          </Button>
        )}
        {/* 发送按钮 - 右边 */}
        {!canGenerateImage && styledSendNode}
      </div>
      <ImagePreview
        src={previewUrl}
        visible={previewVisible}
        onVisibleChange={setPreviewVisible}
      />
    </div>
  );
};

export default CustomInputRender;
