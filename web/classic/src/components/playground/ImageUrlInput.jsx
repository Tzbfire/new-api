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
import { Input, Typography, Button, Switch, ImagePreview, Toast } from '@douyinfe/semi-ui';
import { IconFile } from '@douyinfe/semi-icons';
import { Plus, X, Image, Upload, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ImageUrlInput = ({
  imageUrls,
  imageEnabled,
  onImageUrlsChange,
  onImageEnabledChange,
  disabled = false,
  hideSwitch = false,
  title,
  description,
  referenceMode = false,
}) => {
  const { t } = useTranslation();
  const fileInputRef = React.useRef(null);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [previewVisible, setPreviewVisible] = React.useState(false);

  const validImageUrls = (imageUrls || []).filter((url) => url && url.trim() !== '');

  const readFileAsDataUrl = (file) => {
    if (!file || !file.type?.startsWith('image/')) {
      Toast.warning(t('请选择图片文件'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (typeof dataUrl === 'string') {
        onImageUrlsChange([...(imageUrls || []), dataUrl]);
      }
    };
    reader.onerror = () => Toast.error(t('读取图片失败'));
    reader.readAsDataURL(file);
  };

  const handleUploadImages = (event) => {
    const files = Array.from(event.target.files || []);
    files.forEach(readFileAsDataUrl);
    event.target.value = '';
  };

  const handlePaste = (event) => {
    if (!referenceMode || !imageEnabled || disabled) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.type?.startsWith('image/')) {
        event.preventDefault();
        readFileAsDataUrl(item.getAsFile());
        return;
      }
    }
  };
  const handleAddImageUrl = () => {
    const newUrls = [...imageUrls, ''];
    onImageUrlsChange(newUrls);
  };

  const handleUpdateImageUrl = (index, value) => {
    const newUrls = [...imageUrls];
    newUrls[index] = value;
    onImageUrlsChange(newUrls);
  };

  const handleRemoveImageUrl = (index) => {
    const newUrls = imageUrls.filter((_, i) => i !== index);
    onImageUrlsChange(newUrls);
  };

  const openPreview = (url) => {
    setPreviewUrl(url);
    setPreviewVisible(true);
  };

  return (
    <div className={disabled ? 'opacity-50' : ''} onPaste={handlePaste}>
      <div className='flex items-center justify-between mb-2'>
        <div className='flex items-center gap-2'>
          <Image
            size={16}
            className={
              imageEnabled && !disabled ? 'text-blue-500' : 'text-semi-color-text-3'
            }
          />
          <Typography.Text strong className='text-sm'>
            {title || (referenceMode ? t('参考图') : t('图片地址'))}
          </Typography.Text>
          {disabled && (
            <Typography.Text className='text-xs text-orange-600'>
              ({t('已在自定义模式中忽略')})
            </Typography.Text>
          )}
        </div>
        <div className='flex items-center gap-2'>
          {!hideSwitch && (
            <Switch
              checked={imageEnabled}
              onChange={onImageEnabledChange}
              checkedText={t('启用')}
              uncheckedText={t('停用')}
              size='small'
              className='flex-shrink-0'
              disabled={disabled}
            />
          )}
          <Button
            icon={referenceMode ? <Upload size={14} /> : <Plus size={14} />}
            size='small'
            theme='solid'
            type='primary'
            onClick={referenceMode ? () => fileInputRef.current?.click() : handleAddImageUrl}
            className='!rounded-full !w-4 !h-4 !p-0 !min-w-0'
            disabled={!imageEnabled || disabled}
            title={referenceMode ? t('上传参考图') : t('添加图片地址')}
          />
          {referenceMode && (
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*'
              multiple
              className='hidden'
              onChange={handleUploadImages}
            />
          )}
        </div>
      </div>

      {!imageEnabled ? (
        <Typography.Text className='text-xs text-semi-color-text-2 mb-2 block'>
          {description || (disabled
            ? t('图片功能在自定义请求体模式下不可用')
            : referenceMode
              ? t('上传或粘贴参考图后，会自动使用参考图生成')
              : t('启用后可添加图片URL进行多模态对话'))}
        </Typography.Text>
      ) : validImageUrls.length === 0 ? (
        <Typography.Text className='text-xs text-semi-color-text-2 mb-2 block'>
          {description || (disabled
            ? t('图片功能在自定义请求体模式下不可用')
            : referenceMode
              ? t('点击上传按钮，或直接 Ctrl+V 粘贴图片')
              : t('点击 + 按钮添加图片URL进行多模态对话'))}
        </Typography.Text>
      ) : (
        <Typography.Text className='text-xs text-semi-color-text-2 mb-2 block'>
          {description || `${t('已添加')} ${validImageUrls.length} ${referenceMode ? t('张参考图') : t('张图片')}`}
          {disabled ? ` (${t('自定义模式下不可用')})` : ''}
        </Typography.Text>
      )}

      {referenceMode ? (
        <div className={`grid grid-cols-3 gap-2 max-h-40 overflow-y-auto image-list-scroll ${!imageEnabled || disabled ? 'opacity-50' : ''}`}>
          {validImageUrls.map((url, index) => (
            <div key={`${url.slice(0, 32)}-${index}`} className='group relative aspect-square overflow-hidden rounded-lg border bg-semi-color-fill-0'>
              <img
                src={url}
                alt={`${t('参考图')} ${index + 1}`}
                className='h-full w-full object-cover'
              />
              <div className='absolute inset-0 hidden items-center justify-center gap-1 bg-black/35 group-hover:flex'>
                <Button
                  icon={<Eye size={13} />}
                  size='small'
                  theme='solid'
                  type='tertiary'
                  onClick={() => openPreview(url)}
                  className='!h-7 !w-7 !min-w-0 !rounded-full !p-0'
                  disabled={!imageEnabled || disabled}
                  title={t('预览')}
                />
                <Button
                  icon={<X size={13} />}
                  size='small'
                  theme='solid'
                  type='danger'
                  onClick={() => handleRemoveImageUrl(imageUrls.indexOf(url))}
                  className='!h-7 !w-7 !min-w-0 !rounded-full !p-0'
                  disabled={!imageEnabled || disabled}
                  title={t('删除')}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={`space-y-2 max-h-32 overflow-y-auto image-list-scroll ${!imageEnabled || disabled ? 'opacity-50' : ''}`}
        >
          {imageUrls.map((url, index) => (
            <div key={index} className='flex items-center gap-2'>
              <div className='flex-1'>
                <Input
                  placeholder={`https://example.com/image${index + 1}.jpg`}
                  value={url}
                  onChange={(value) => handleUpdateImageUrl(index, value)}
                  className='!rounded-lg'
                  size='small'
                  prefix={<IconFile size='small' />}
                  disabled={!imageEnabled || disabled}
                />
              </div>
              <Button
                icon={<X size={12} />}
                size='small'
                theme='borderless'
                type='danger'
                onClick={() => handleRemoveImageUrl(index)}
                className='!rounded-full !w-6 !h-6 !p-0 !min-w-0 !text-red-500 hover:!bg-red-50 flex-shrink-0'
                disabled={!imageEnabled || disabled}
              />
            </div>
          ))}
        </div>
      )}
      <ImagePreview
        src={previewUrl}
        visible={previewVisible}
        onVisibleChange={setPreviewVisible}
      />
    </div>
  );
};

export default ImageUrlInput;
