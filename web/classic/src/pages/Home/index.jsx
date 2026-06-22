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

import React, { useEffect, useState } from 'react';
import Hero from './Hero';
import PricingAndTutorial from './Pricing';
import ConfigGenerator from './ConfigGenerator';
import IntegrationGuide from './IntegrationGuide';
import PricingCalculator from './PricingCalculator';
import ModelDistribution from './ModelDistribution';
import { API, showError } from '../../helpers';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { useActualTheme } from '../../context/Theme';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import NoticeModal from '../../components/layout/NoticeModal';

const Home = () => {
  const { i18n } = useTranslation();
  const actualTheme = useActualTheme();
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(false);
  const [homePageContent, setHomePageContent] = useState('');
  const [noticeVisible, setNoticeVisible] = useState(false);
  const isMobile = useIsMobile();

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    const res = await API.get('/api/home_page_content');
    const { success, message, data } = res.data;
    if (success) {
      const contentData = data || '';
      if (!contentData) {
        localStorage.removeItem('home_page_content');
        setHomePageContent('');
      } else if (contentData.startsWith('https://')) {
        setHomePageContent(contentData);
        localStorage.setItem('home_page_content', contentData);
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

  const handleHomeIframeLoad = (event) => {
    event.currentTarget.contentWindow?.postMessage(
      { themeMode: actualTheme },
      '*',
    );
    event.currentTarget.contentWindow?.postMessage({ lang: i18n.language }, '*');
  };

  return (
    <div
      className='classic-page-fill classic-home-page w-full overflow-x-hidden'
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
        <div className='classic-home-default w-full overflow-x-hidden'>
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
        <div className='classic-page-fill overflow-x-hidden w-full'>
          {homePageContent.startsWith('https://') ? (
            <iframe
              src={homePageContent}
              className='w-full h-screen border-none'
              onLoad={handleHomeIframeLoad}
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
