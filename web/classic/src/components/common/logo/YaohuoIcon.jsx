import React from 'react';

// 妖火 (yaohuo.me) LOGO - 使用用户亲自裁剪的完美版本
const YaohuoIcon = (props) => {
  const { size, width, height, style, ...rest } = props;
  const displayHeight = height || size || 24;
  const displayWidth = width || displayHeight;

  return (
    <img
      src='/yaohuo_logo.jpg'
      alt='Yaohuo Logo'
      style={{
        height: displayHeight,
        width: displayWidth,
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: 'middle',
        ...style,
      }}
      {...rest}
    />
  );
};

export default YaohuoIcon;
