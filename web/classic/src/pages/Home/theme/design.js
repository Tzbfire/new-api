// 颜色全部使用 Semi UI 设计变量，使首页能自动适配亮/暗主题
export const theme = {
  colors: {
    background: {
      primary: 'var(--semi-color-bg-0)',
      secondary: 'var(--semi-color-bg-1)',
      surface: 'var(--semi-color-bg-0)',
      surfaceHover: 'var(--semi-color-fill-0)',
    },
    border: {
      default: 'var(--semi-color-border)',
      focus: 'var(--semi-color-focus-border)',
      active: 'var(--semi-color-primary-light-active)',
    },
    text: {
      title: 'var(--semi-color-text-0)',
      body: 'var(--semi-color-text-1)',
      muted: 'var(--semi-color-text-2)',
    },
    primary: {
      main: 'var(--semi-color-primary)',
      hover: 'var(--semi-color-primary-hover)',
      light: 'var(--semi-color-primary-light-default)',
    },
    success: {
      main: 'var(--semi-color-success)',
      bg: 'var(--semi-color-success-light-default)',
    },
  },
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
  },
  layout: {
    maxWidth: 1100,
    sectionPadding: '80px 24px',
  },
  typography: {
    h1: {
      fontSize: 'clamp(2.5rem, 5vw, 4rem)',
      fontWeight: 800,
      lineHeight: 1.15,
      letterSpacing: '-0.02em',
      color: 'var(--semi-color-text-0)',
    },
    h2: {
      fontSize: 'clamp(1.8rem, 3vw, 2.5rem)',
      fontWeight: 800,
      lineHeight: 1.25,
      letterSpacing: '-0.025em',
      color: 'var(--semi-color-text-0)',
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 700,
      color: 'var(--semi-color-text-0)',
    },
    body: {
      fontSize: '1rem',
      lineHeight: 1.7,
      color: 'var(--semi-color-text-1)',
    },
    subtitle: {
      fontSize: '1.125rem',
      lineHeight: 1.6,
      color: 'var(--semi-color-text-2)',
    },
    small: { fontSize: '0.875rem', color: 'var(--semi-color-text-2)' },
  },
};
