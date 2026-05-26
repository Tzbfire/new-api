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

import React, { useContext, useEffect, useState } from 'react';
import {
  Button,
  Typography,
  Input,
  ScrollList,
  ScrollItem,
} from '@douyinfe/semi-ui';
import Hero from './Hero';
import PricingAndTutorial from './Pricing';
import ConfigGenerator from './ConfigGenerator';
import IntegrationGuide from './IntegrationGuide';
import PricingCalculator from './PricingCalculator';
import ModelDistribution from './ModelDistribution';
import { API, showError, copy, showSuccess } from '../../helpers';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { API_ENDPOINTS } from '../../constants/common.constant';
import { StatusContext } from '../../context/Status';
import { useActualTheme } from '../../context/Theme';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import {
  IconGithubLogo,
  IconPlay,
  IconFile,
  IconCopy,
} from '@douyinfe/semi-icons';
import { Link } from 'react-router-dom';
import NoticeModal from '../../components/layout/NoticeModal';

const { Text } = Typography;

const Home = () => {
  const { t, i18n } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const actualTheme = useActualTheme();
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(false);
  const [homePageContent, setHomePageContent] = useState('');
  const [noticeVisible, setNoticeVisible] = useState(false);
  const isMobile = useIsMobile();
  const isDemoSiteMode = statusState?.status?.demo_site_enabled || false;
  const docsLink = statusState?.status?.docs_link || '';
  const serverAddress =
    statusState?.status?.server_address || `${window.location.origin}`;
  const endpointItems = API_ENDPOINTS.map((e) => ({ value: e }));
  const [endpointIndex, setEndpointIndex] = useState(0);
  const isChinese = i18n.language.startsWith('zh');

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    const res = await API.get('/api/home_page_content');
    const { success, message, data } = res.data;
    if (success) {
      const contentData = data || '';
      if (!contentData) {
        // 管理员没有配置首页内容 — 清空缓存、显示默认页
        localStorage.removeItem('home_page_content');
        setHomePageContent('');
      } else if (
        contentData.startsWith('http://') ||
        contentData.startsWith('https://')
      ) {
        // 远程 URL — 原生拉取
        fetch(contentData)
          .then((r) => {
            if (!r.ok) throw new Error('CORS or Network issue');
            return r.text();
          })
          .then((html) => {
            setHomePageContent(html);
            localStorage.setItem('home_page_content', html);
          })
          .catch((err) => {
            console.warn('Fetch docs error:', err);
            const fallbackHtml =
              '<div style="padding:40px;text-align:center;">无法无缝加载远程文档 (可能被所在服务器拦截，请开放CORS或配置代理)。<br/><a href="' +
              contentData +
              '" target="_blank" style="color:#0056b3;text-decoration:underline;">点此新访问</a></div>';
            setHomePageContent(fallbackHtml);
          });
      } else {
        const content = marked.parse(contentData);
        setHomePageContent(content);
        localStorage.setItem('home_page_content', content);
      }
    } else {
      showError(message);
      setHomePageContent('');
    }
    setHomePageContentLoaded(true);
  };

  const handleCopyBaseURL = async () => {
    const ok = await copy(serverAddress);
    if (ok) {
      showSuccess(t('已复制到剪切板'));
    }
  };

  useEffect(() => {
    const checkNoticeAndShow = async () => {
      const lastCloseDate = localStorage.getItem('notice_close_date');
      const today = new Date().toDateString();
      if (lastCloseDate !== today) {
        try {
          const res = await API.get('/api/notice');
          const { success, data } = res.data;
          if (success && data && data.trim() !== '') {
            setNoticeVisible(true);
          }
        } catch (error) {
          console.error('获取公告失败:', error);
        }
      }
    };

    checkNoticeAndShow();
  }, []);

  useEffect(() => {
    displayHomePageContent().then();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setEndpointIndex((prev) => (prev + 1) % endpointItems.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [endpointItems.length]);

  return (
    <div
      className='w-full overflow-x-hidden'
      style={{
        background: 'var(--semi-color-bg-0)',
        minHeight: '100vh',
        color: 'var(--semi-color-text-0)',
      }}
    >
      <NoticeModal
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        isMobile={isMobile}
      />
      {homePageContentLoaded && homePageContent === '' ? (
        <div className='w-full overflow-x-hidden'>
          {/* Hero: brand entry point */}
          <Hero />
          {/* First recharge and billing options */}
          <PricingAndTutorial />
          {/* Config generator for AI tools */}
          <div id='quick-start'>
            <ConfigGenerator />
          </div>
          {/* Transparent pricing calculator */}
          <div id='pricing-calculator'>
            <PricingCalculator />
          </div>
          <IntegrationGuide />
          {/* Live model distribution */}
          <ModelDistribution />
        </div>
      ) : (
        <div className='overflow-x-hidden w-full'>
          {homePageContent.startsWith('http://') ||
          homePageContent.startsWith('https://') ? (
            <div
              className='w-full min-h-screen'
              dangerouslySetInnerHTML={{ __html: homePageContent }}
            />
          ) : (
            <div
              className='mt-[60px]'
              dangerouslySetInnerHTML={{ __html: homePageContent }}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default Home;
