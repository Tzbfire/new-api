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

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Empty,
  Image,
  InputNumber,
  Select,
  Spin,
  Tabs,
  TabPane,
  Tag,
  TextArea,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconImage,
  IconDownload,
  IconBolt,
  IconCopy,
  IconClose,
  IconPlus,
} from '@douyinfe/semi-icons';
import {
  API,
  processGroupsData,
  processModelsData,
  showError,
  showSuccess,
} from '../../helpers';
import { renderQuota } from '../../helpers/render';
import JSZip from 'jszip';
import {
  loadHistory,
  saveItems,
  updateCost as updateHistoryCost,
  deleteItem as deleteHistoryItem,
  clearHistory as clearAllHistory,
} from '../../helpers/imageHistory';
import { UserContext } from '../../context/User';

const { Text, Title } = Typography;

const ASPECT_OPTIONS = [
  { label: '1:1 方图', value: '1024x1024' },
  { label: '2:3 竖图', value: '1024x1536' },
  { label: '3:2 横图', value: '1536x1024' },
  { label: '9:16 手机竖屏', value: '1024x1792' },
  { label: '16:9 宽屏', value: '1792x1024' },
  { label: '自动', value: 'auto' },
];

// 比例 → 实际 size 的「档位 × 比例」映射表（D-Plus 方案）
// 仅当模型配置了 size_prices 时启用，画室会显示「档位 + 比例」双控件。
const ASPECT_KEYS = [
  { key: '1:1', label: '1:1' },
  { key: '3:2', label: '3:2' },
  { key: '2:3', label: '2:3' },
  { key: '16:9', label: '16:9' },
  { key: '9:16', label: '9:16' },
  { key: 'auto', label: '自动' },
];

const TIER_KEYS = ['1K', '2K', '4K'];

// 档位 × 比例 → 实际 size 字符串
// 与后端 setting/operation_setting/image_size_tier.go 的白名单保持一致
const TIER_ASPECT_TO_SIZE = {
  '1K': {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    auto: 'auto',
  },
  '2K': {
    '1:1': '1920x1920',
    '3:2': '2368x1576',
    '2:3': '1576x2368',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    auto: '1920x1920',
  },
  '4K': {
    '1:1': '2880x2880',
    '3:2': '3552x2368',
    '2:3': '2368x3552',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    auto: '2880x2880',
  },
};

// size 字符串 → 档位（与后端 ClassifyImageSizeTier 对齐的简化版，仅识别白名单 size）
const SIZE_TO_TIER = (() => {
  const m = {};
  Object.keys(TIER_ASPECT_TO_SIZE).forEach((tier) => {
    Object.values(TIER_ASPECT_TO_SIZE[tier]).forEach((sz) => {
      if (!m[sz]) m[sz] = tier;
    });
  });
  return m;
})();

// size 字符串 → 比例 key
const SIZE_TO_ASPECT = (() => {
  const m = { auto: 'auto' };
  Object.keys(TIER_ASPECT_TO_SIZE).forEach((tier) => {
    Object.entries(TIER_ASPECT_TO_SIZE[tier]).forEach(([asp, sz]) => {
      if (!m[sz]) m[sz] = asp;
    });
  });
  return m;
})();

const PROMPT_PRESETS = [
  '电影感清晨薄雾森林特写，柔和金光，超写实',
  '极简主义产品大片：一台手机置于大理石台面，工作室灯光，写实质感',
  '赛博朋克霓虹城市，雨夜，湿漉反光的街道，银翼杀手氛围',
  '可爱 3D 等距小房间，马卡龙色系，blender 风格，octane 渲染',
];

const isImageGenModel = (m) => {
  if (!m) return false;
  const v = (m.value || m).toString().toLowerCase();
  return v.startsWith('gpt-image') || v.startsWith('dall-e') || v.includes('image');
};

const ImageStudio = () => {
  const { t } = useTranslation();
  const [userState, userDispatch] = useContext(UserContext);

  const [groups, setGroups] = useState([]);
  const [models, setModels] = useState([]);
  const [group, setGroup] = useState('');
  const [model, setModel] = useState('');
  const [imageModelsByGroup, setImageModelsByGroup] = useState({}); // groupValue -> imageModelOption[]
  const [groupHasNoImageModel, setGroupHasNoImageModel] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [n, setN] = useState(1);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [lastCost, setLastCost] = useState(null); // 上次本次消耗的 quota

  // 价格表与分组倍率（用于生成前预估费用）
  const [pricingMap, setPricingMap] = useState({}); // model -> pricing entry
  const [groupRatioMap, setGroupRatioMap] = useState({}); // group -> ratio

  // 模式：t2i = 文生图 / i2i = 图生图
  const [mode, setMode] = useState('t2i');
  const [refFiles, setRefFiles] = useState([]); // File[]
  const fileInputRef = useRef(null);
  const [refPreviews, setRefPreviews] = useState([]); // string[] dataURL
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // 当 refFiles 变化时生成预览 URL
  useEffect(() => {
    let revoked = [];
    const urls = refFiles.map((f) => {
      const u = URL.createObjectURL(f);
      revoked.push(u);
      return u;
    });
    setRefPreviews(urls);
    return () => revoked.forEach((u) => URL.revokeObjectURL(u));
  }, [refFiles]);

  // 统一往参考图列表追加图片：自动切到 i2i、限制 6 张、提示溢出
  const appendRefFiles = useCallback(
    (rawFiles, opts = {}) => {
      const files = Array.from(rawFiles || []).filter(
        (f) => f && f.type && f.type.startsWith('image/'),
      );
      if (files.length === 0) return 0;
      let added = 0;
      setRefFiles((prev) => {
        const room = 6 - prev.length;
        if (room <= 0) {
          showError(t('参考图最多 6 张'));
          return prev;
        }
        const slice = files.slice(0, room);
        added = slice.length;
        if (files.length > room) {
          showError(t('参考图最多 6 张，已截断'));
        }
        return [...prev, ...slice];
      });
      if (added > 0) {
        setMode((m) => (m === 'i2i' ? m : 'i2i'));
        if (!opts.silent) {
          showSuccess(t('已添加 {{n}} 张参考图', { n: added }));
        }
      }
      return added;
    },
    [t],
  );

  const onPickFiles = (e) => {
    appendRefFiles(e.target.files, { silent: true });
    e.target.value = '';
  };
  const removeRef = (idx) =>
    setRefFiles((prev) => prev.filter((_, i) => i !== idx));

  // 全局粘贴：剪贴板含图片时加入参考图
  useEffect(() => {
    const onPaste = (e) => {
      const target = e.target;
      const tag = target?.tagName;
      const isEditable =
        target?.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT';
      const items = e.clipboardData?.items || [];
      const imgs = [];
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) imgs.push(f);
        }
      }
      if (imgs.length === 0) return;
      // 即便焦点在输入框，只要剪贴板里有图片就拦截
      e.preventDefault();
      if (isEditable && tag !== 'TEXTAREA' && tag !== 'INPUT') {
        // contentEditable 区域不打断
        return;
      }
      appendRefFiles(imgs);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [appendRefFiles]);

  // 页面级拖拽：仅当数据是文件时高亮
  const onDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };
  const onDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };
  const onDrop = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer.files || [];
    appendRefFiles(files);
  };

  const LS_LAST_GROUP = 'image_studio.last_group';
  const LS_LAST_MODEL = 'image_studio.last_model';

  const loadGroups = useCallback(async () => {
    try {
      const res = await API.get('/api/user/self/groups');
      const { success, data } = res.data;
      if (success) {
        const userGroup =
          userState?.user?.group ||
          JSON.parse(localStorage.getItem('user') || '{}')?.group;
        const opts = processGroupsData(data || {}, userGroup);
        setGroups(opts);
        return opts;
      }
    } catch (e) {}
    return [];
  }, [userState?.user?.group]);

  const fetchImageModelsForGroup = useCallback(async (g) => {
    try {
      const q = g ? `?group=${encodeURIComponent(g)}` : '';
      const res = await API.get(`/api/user/models${q}`);
      const { success, data } = res.data;
      if (success) {
        const { modelOptions } = processModelsData(data, '');
        return modelOptions.filter(isImageGenModel);
      }
    } catch (e) {}
    return [];
  }, []);

  const pickPreferredModel = (imageModels) => {
    if (!imageModels || imageModels.length === 0) return '';
    const lastModel = localStorage.getItem(LS_LAST_MODEL);
    if (lastModel && imageModels.some((m) => m.value === lastModel)) {
      return lastModel;
    }
    const gpt = imageModels.find((m) => m.value === 'gpt-image-2');
    if (gpt) return gpt.value;
    return imageModels[0].value;
  };

  useEffect(() => {
    // 拉取价格表
    (async () => {
      try {
        const r = await API.get('/api/pricing');
        if (r.data?.success && r.data?.data) {
          const map = {};
          (r.data.data || []).forEach((p) => {
            map[p.model_name] = p;
          });
          setPricingMap(map);
          setGroupRatioMap(r.data.group_ratio || {});
        }
      } catch (e) {}
    })();

    // 智能初始化：拉所有分组并并行扫描每个分组的图像模型，挑选最优默认
    (async () => {
      const opts = await loadGroups();
      if (!opts || opts.length === 0) return;

      const results = await Promise.all(
        opts.map(async (g) => [g.value, await fetchImageModelsForGroup(g.value)]),
      );
      const map = {};
      results.forEach(([g, list]) => {
        map[g] = list;
      });
      setImageModelsByGroup(map);

      const lastGroup = localStorage.getItem(LS_LAST_GROUP);
      const userGroup =
        userState?.user?.group ||
        JSON.parse(localStorage.getItem('user') || '{}')?.group;
      const groupHasImage = (g) => Array.isArray(map[g]) && map[g].length > 0;

      let chosenGroup = '';
      if (lastGroup && opts.some((o) => o.value === lastGroup) && groupHasImage(lastGroup)) {
        chosenGroup = lastGroup;
      } else if (userGroup && opts.some((o) => o.value === userGroup) && groupHasImage(userGroup)) {
        chosenGroup = userGroup;
      } else {
        const firstWithImage = opts.find((o) => groupHasImage(o.value));
        chosenGroup = firstWithImage ? firstWithImage.value : opts[0].value;
      }

      setGroup(chosenGroup);
      const list = map[chosenGroup] || [];
      setModels(list);
      setGroupHasNoImageModel(list.length === 0);
      if (list.length > 0) {
        setModel(pickPreferredModel(list));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用户切换分组：从已聚合的 map 取模型；按优先级选 model；写入 localStorage
  useEffect(() => {
    if (!group) return;
    localStorage.setItem(LS_LAST_GROUP, group);
    if (Object.keys(imageModelsByGroup).length === 0) return;
    const list = imageModelsByGroup[group] || [];
    setModels(list);
    setGroupHasNoImageModel(list.length === 0);
    if (list.length === 0) {
      setModel('');
      return;
    }
    if (!list.some((m) => m.value === model)) {
      setModel(pickPreferredModel(list));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, imageModelsByGroup]);

  // 用户切换模型：写入 localStorage
  useEffect(() => {
    if (model) localStorage.setItem(LS_LAST_MODEL, model);
  }, [model]);

  // 当用户 id 就绪时从 IndexedDB 恢复历史生成记录（避免 mount 时 id 还未加载导致读到错误的桶）
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    const uid = userState?.user?.id;
    if (uid == null || historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    (async () => {
      try {
        const list = await loadHistory(uid);
        if (Array.isArray(list) && list.length > 0) {
          setResults((prev) => {
            const existIds = new Set(prev.map((x) => x.id));
            const merged = [...prev, ...list.filter((x) => !existIds.has(x.id))];
            return merged;
          });
        }
      } catch (e) {}
    })();
  }, [userState?.user?.id]);

  const canGenerate = useMemo(() => {
    if (loading || !model || !prompt.trim()) return false;
    if (mode === 'i2i' && refFiles.length === 0) return false;
    return true;
  }, [loading, model, prompt, mode, refFiles]);

  // 计算 dall-e 系列的 size & quality 系数，gpt-image / 其他默认 1
  const computeSizeRatio = (m, s) => {
    if (!m || !m.toLowerCase().startsWith('dall-e')) return 1;
    if (s === '256x256') return 0.4;
    if (s === '512x512') return 0.45;
    if (s === '1024x1024') return 1;
    if (s === '1024x1792' || s === '1792x1024') return 2;
    return 1;
  };

  // 当前模型是否启用「分辨率档位定价」（D-Plus 方案）
  const sizePrices = useMemo(() => {
    const p = pricingMap[model];
    return p && p.size_prices && Object.keys(p.size_prices).length > 0
      ? p.size_prices
      : null;
  }, [pricingMap, model]);

  // 模型有 size_prices 时，从当前 size 反推「档位 + 比例」用于 UI 选中态
  const currentTier = useMemo(() => SIZE_TO_TIER[size] || '2K', [size]);
  const currentAspect = useMemo(() => SIZE_TO_ASPECT[size] || '1:1', [size]);

  // 切换档位/比例时，重组 size 字符串
  const applyTierAspect = (tier, aspect) => {
    const map = TIER_ASPECT_TO_SIZE[tier];
    if (!map) return;
    const next = map[aspect] || map['1:1'];
    setSize(next);
  };

  // 各档位预估单张价格（quota 单位），用于档位 chip 上显示
  const tierEstimates = useMemo(() => {
    if (!sizePrices) return null;
    const QUOTA_PER_UNIT = Number(
      localStorage.getItem('quota_per_unit') || 500000,
    );
    const groupRatio = Number(groupRatioMap[group] ?? 1) || 1;
    const out = {};
    TIER_KEYS.forEach((tier) => {
      const price = sizePrices[tier];
      if (typeof price === 'number' && price > 0) {
        out[tier] = price * QUOTA_PER_UNIT * groupRatio;
      }
    });
    return out;
  }, [sizePrices, groupRatioMap, group]);

  // 预估本次生成费用（quota 单位）
  const estimatedQuota = useMemo(() => {
    const p = pricingMap[model];
    if (!p) return null;
    const QUOTA_PER_UNIT = Number(
      localStorage.getItem('quota_per_unit') || 500000,
    );
    const groupRatio = Number(groupRatioMap[group] ?? 1) || 1;
    const count = Math.max(1, Number(n) || 1);
    // D-Plus：分辨率档位定价优先
    if (sizePrices) {
      const tierPrice = sizePrices[currentTier];
      if (typeof tierPrice === 'number' && tierPrice > 0) {
        return tierPrice * QUOTA_PER_UNIT * groupRatio * count;
      }
    }
    const sizeRatio = computeSizeRatio(model, size);
    if (p.quota_type === 1 && p.model_price > 0) {
      return p.model_price * QUOTA_PER_UNIT * groupRatio * sizeRatio * count;
    }
    if (p.quota_type === 0 && p.image_ratio && p.model_ratio) {
      return (
        p.image_ratio * p.model_ratio * QUOTA_PER_UNIT * groupRatio * count
      );
    }
    return null;
  }, [pricingMap, groupRatioMap, model, group, size, n, sizePrices, currentTier]);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setLoading(true);
    try {
      let res;
      if (mode === 'i2i') {
        const fd = new FormData();
        fd.append('group', group);
        fd.append('model', model);
        fd.append('prompt', prompt.trim());
        fd.append('n', String(n));
        fd.append('size', size);
        refFiles.forEach((f) => {
          // OpenAI 协议：单图用 'image'，多图用 'image[]'
          fd.append(refFiles.length > 1 ? 'image[]' : 'image', f, f.name);
        });
        res = await API.post('/pg/images/edits', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 5 * 60 * 1000,
        });
      } else {
        const body = {
          group,
          model,
          prompt: prompt.trim(),
          n,
          size,
        };
        res = await API.post('/pg/images/generations', body, {
          timeout: 5 * 60 * 1000,
        });
      }
      const data = res.data;

      let images = [];
      if (Array.isArray(data?.data)) images = data.data;
      else if (Array.isArray(data?.data?.data)) images = data.data.data;
      else if (data?.success === false) {
        showError(data.message || t('生成失败'));
        return;
      }

      if (images.length === 0) {
        showError(t('未返回图片，请检查模型与配额'));
        return;
      }

      const ts = Date.now();
      const newItems = images.map((it, idx) => {
        let src = '';
        let ext = 'png';
        if (it.url) {
          src = it.url;
          const m = it.url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
          if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
        } else if (it.b64_json) {
          src = `data:image/png;base64,${it.b64_json}`;
        }
        return {
          id: `${ts}-${idx}`,
          src,
          ext,
          model,
          prompt: prompt.trim(),
          size,
          mode,
          ts,
          batchId: `b-${ts}`,
          batchSize: images.length,
          cost: null, // 待 600ms 后回填
        };
      });
      const batchId = newItems[0].batchId;
      setResults((prev) => [...newItems, ...prev]);
      showSuccess(t('生成成功'));

      // 持久化到 IndexedDB
      saveItems(userState?.user?.id, newItems);

      const requestId =
        res?.headers?.['x-oneapi-request-id'] ||
        res?.headers?.['X-Oneapi-Request-Id'] ||
        '';

      // 异步刷新用户余额；同时按 request_id 从日志拉取真实记账金额，确保与「使用日志」绝对一致
      API.get('/api/user/self')
        .then((r) => {
          if (r?.data?.success && r?.data?.data) {
            userDispatch({ type: 'login', payload: r.data.data });
          }
        })
        .catch(() => {});

      if (requestId) {
        const fetchRealCost = async () => {
          for (let i = 0; i < 6; i++) {
            await new Promise((rs) => setTimeout(rs, i === 0 ? 800 : 1200));
            try {
              const lr = await API.get('/api/log/self', {
                params: { p: 1, page_size: 10, request_id: requestId },
              });
              const items =
                lr?.data?.data?.items ||
                lr?.data?.data?.records ||
                lr?.data?.data ||
                [];
              const list = Array.isArray(items) ? items : [];
              const matched = list.find(
                (x) => x && (x.request_id === requestId || x.requestId === requestId),
              );
              if (matched && typeof matched.quota === 'number') {
                const real = matched.quota;
                setLastCost(real);
                setResults((prev) =>
                  prev.map((it) =>
                    it.batchId === batchId ? { ...it, cost: real } : it,
                  ),
                );
                updateHistoryCost(userState?.user?.id, batchId, real);
                return;
              }
            } catch (e) {}
          }
        };
        fetchRealCost();
      }
    } catch (e) {
      const msg =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        t('生成失败');
      showError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 纯前端拉取远程图为 Blob，多策略 fallback
  // 1) fetch CORS — 速度最快，原文件
  // 2) <img crossOrigin> + canvas — 上游需带 ACAO 头；会重编码为 PNG
  const fetchRemoteAsBlob = async (url) => {
    try {
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (r.ok) return await r.blob();
    } catch (_) {}
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('toBlob 返回空'))),
            'image/png',
          );
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('图片加载失败（可能未启用 CORS）'));
      img.src = url;
    });
  };

  const downloadOne = async (item) => {
    const filename = `${item.model}-${item.id}.${item.ext || 'png'}`;
    if (typeof item.src === 'string' && item.src.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = item.src;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    try {
      const blob = await fetchRemoteAsBlob(item.src);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      // 兜底：a download；同源/带 CD 头时奏效，否则会打开新页让用户右键
      const a = document.createElement('a');
      a.href = item.src;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showSuccess(t('已尝试触发下载，若打开了新页请右键另存'));
    }
  };

  const reusePrompt = (item) => {
    setPrompt(item.prompt);
    setSize(item.size);
    setModel(item.model);
    showSuccess(t('已回填参数'));
  };

  const removeOne = (id) => {
    setResults((prev) => prev.filter((x) => x.id !== id));
    deleteHistoryItem(userState?.user?.id, id);
  };

  // 把结果图作为参考图加入 i2i 上传列表
  const useAsReference = async (item) => {
    try {
      let blob;
      if (item.src.startsWith('data:')) {
        const r = await fetch(item.src);
        blob = await r.blob();
      } else {
        // 远程图：尝试 fetch；CORS 失败则提示用户手动下载后上传
        try {
          const r = await fetch(item.src, { mode: 'cors' });
          if (!r.ok) throw new Error('fetch failed');
          blob = await r.blob();
        } catch (e) {
          showError(
            t('该图片受跨域限制，无法直接拾取，请右键另存后手动上传'),
          );
          return;
        }
      }
      const ext = item.ext || 'png';
      const file = new File([blob], `ref-${item.id}.${ext}`, {
        type: blob.type || `image/${ext}`,
      });
      setRefFiles((prev) => {
        if (prev.length >= 6) {
          showError(t('参考图最多 6 张'));
          return prev;
        }
        return [...prev, file];
      });
      if (mode !== 'i2i') setMode('i2i');
      showSuccess(t('已加入参考图'));
    } catch (e) {
      showError(t('拾取失败：') + (e?.message || ''));
    }
  };

  const clearAll = () => {
    setResults([]);
    clearAllHistory(userState?.user?.id);
  };

  // ZIP 打包下载
  const downloadAll = async () => {
    if (results.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    try {
      const zip = new JSZip();
      const folderName = `image-studio-${new Date()
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 14)}`;
      const folder = zip.folder(folderName);
      const manifestLines = [];
      const failed = [];
      let okCount = 0;

      for (let i = 0; i < results.length; i++) {
        const it = results[i];
        const ext = (it.ext || 'png').replace(/^\./, '');
        const fname = `${String(i + 1).padStart(2, '0')}-${(it.model || 'img').replace(/[^\w.-]+/g, '_')}.${ext}`;
        try {
          let blob;
          if (typeof it.src === 'string' && it.src.startsWith('data:')) {
            const r = await fetch(it.src);
            blob = await r.blob();
          } else {
            blob = await fetchRemoteAsBlob(it.src);
          }
          folder.file(fname, blob);
          manifestLines.push(
            `[${i + 1}] ${fname}\n  model: ${it.model || ''}\n  size:  ${it.size || ''}\n  prompt: ${it.prompt || ''}\n`,
          );
          okCount++;
        } catch (e) {
          failed.push({ index: i + 1, src: it.src, reason: e?.message || 'error' });
          manifestLines.push(
            `[${i + 1}] (FAILED: ${e?.message || 'error'})\n  url: ${it.src}\n  model: ${it.model || ''}\n  prompt: ${it.prompt || ''}\n`,
          );
        }
      }

      folder.file(
        'manifest.txt',
        `AI 画室生成结果\n生成时间: ${new Date().toLocaleString()}\n共 ${results.length} 张，成功 ${okCount} 张，失败 ${failed.length} 张\n\n${manifestLines.join('\n')}`,
      );

      if (okCount === 0) {
        showError(
          t('全部图片均无法下载（多为远程图片跨域），请尝试在每张图上单击右键另存'),
        );
        return;
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE', // 图片已压缩，再压缩反而慢
      });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      if (failed.length === 0) {
        showSuccess(t('已打包 {{n}} 张到 ZIP', { n: okCount }));
      } else {
        showSuccess(
          t('已打包 {{ok}} 张，{{fail}} 张失败（详见 manifest.txt）', {
            ok: okCount,
            fail: failed.length,
          }),
        );
      }
    } catch (e) {
      showError(t('打包失败：') + (e?.message || ''));
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div
      className='mt-[60px] px-3 sm:px-6 pb-10 max-w-[1600px] mx-auto relative'
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div className='fixed inset-0 z-[999] pointer-events-none flex items-center justify-center'>
          <div className='absolute inset-4 rounded-3xl border-4 border-dashed border-purple-400 bg-purple-500/10 backdrop-blur-sm' />
          <div className='relative px-6 py-4 rounded-2xl bg-white/90 dark:bg-slate-800/90 shadow-2xl border border-purple-300 flex items-center gap-3'>
            <span className='inline-flex w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white items-center justify-center'>
              <IconImage size='large' />
            </span>
            <div className='leading-tight'>
              <div className='font-semibold'>{t('松开以添加为参考图')}</div>
              <div className='text-xs text-semi-color-text-2'>
                {t('支持多图，最多 6 张')}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Hero / 标题 */}
      <div className='flex items-end justify-between flex-wrap gap-3 mb-5'>
        <div>
          <Title heading={3} className='!mb-1 flex items-center gap-2'>
            <span className='inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-md'>
              <IconImage />
            </span>
            {t('AI 画室')}
          </Title>
          <Text type='tertiary'>
            {t('描述你脑海中的画面，让 AI 帮你即刻成像')}
          </Text>
        </div>
        <div className='flex items-center gap-2 flex-wrap'>
          {/* 余额信息条 */}
          <div className='flex items-center gap-3 px-3 py-2 rounded-xl border border-semi-color-border bg-semi-color-bg-1 shadow-sm text-sm'>
            <div className='flex flex-col items-end leading-tight'>
              <span className='text-[11px] text-semi-color-text-2'>{t('余额')}</span>
              <span className='font-semibold text-emerald-600 dark:text-emerald-400'>
                {renderQuota(userState?.user?.quota || 0, 4)}
              </span>
            </div>
            <div className='w-px h-6 bg-semi-color-border' />
            <div className='flex flex-col items-end leading-tight'>
              <span className='text-[11px] text-semi-color-text-2'>{t('累计已用')}</span>
              <span className='font-medium'>
                {renderQuota(userState?.user?.used_quota || 0, 2)}
              </span>
            </div>
            {lastCost != null && (
              <>
                <div className='w-px h-6 bg-semi-color-border' />
                <div className='flex flex-col items-end leading-tight'>
                  <span className='text-[11px] text-semi-color-text-2'>{t('上次消耗')}</span>
                  <span className='font-medium text-rose-500'>
                    -{renderQuota(lastCost, 4)}
                  </span>
                </div>
              </>
            )}
          </div>
          {results.length > 0 && (
            <>
              <Button
                type='primary'
                theme='solid'
                icon={<IconDownload />}
                onClick={downloadAll}
                size='small'
                loading={downloadingAll}
              >
                {t('下载全部')} ({results.length}) ZIP
              </Button>
              <Button
                type='tertiary'
                icon={<IconClose />}
                onClick={clearAll}
                size='small'
              >
                {t('清空结果')}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5'>
        {/* 控制面板 */}
        <div className='lg:sticky lg:top-[76px] self-start'>
          <div className='rounded-2xl border border-semi-color-border bg-semi-color-bg-1 shadow-sm p-4 flex flex-col gap-4'>
            {/* 模式切换 */}
            <Tabs
              type='button'
              size='small'
              activeKey={mode}
              onChange={setMode}
            >
              <TabPane tab={t('文生图')} itemKey='t2i' />
              <TabPane tab={t('图生图')} itemKey='i2i' />
            </Tabs>

            {/* 模型 + 分组 紧凑一组 */}
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <Text size='small' type='tertiary'>{t('分组')}</Text>
                <Select
                  className='!w-full mt-1'
                  value={group}
                  onChange={setGroup}
                  optionList={groups.map((g) => ({
                    label: `${g.label}${g.ratio != null ? ` ×${g.ratio}` : ''}`,
                    value: g.value,
                  }))}
                  placeholder={t('选择分组')}
                />
              </div>
              <div>
                <Text size='small' type='tertiary'>{t('模型')}</Text>
                <Select
                  className='!w-full mt-1'
                  value={model}
                  onChange={setModel}
                  optionList={models.map((m) => ({
                    label: m.label || m.value,
                    value: m.value,
                  }))}
                  placeholder={t('选择图像模型')}
                  filter
                  showClear
                />
              </div>
            </div>

            {groupHasNoImageModel && (() => {
              const candidates = Object.entries(imageModelsByGroup)
                .filter(([, list]) => Array.isArray(list) && list.length > 0)
                .map(([g]) => g);
              return (
                <div className='rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200/60 dark:border-amber-800/40'>
                  <Text size='small' type='warning'>
                    {t('当前分组「{{g}}」没有可用的图像生成模型。', { g: group })}
                  </Text>
                  {candidates.length > 0 ? (
                    <div className='mt-1 flex flex-wrap items-center gap-2'>
                      <Text size='small' type='tertiary'>{t('可切换到：')}</Text>
                      {candidates.map((g) => (
                        <Button
                          key={g}
                          size='small'
                          theme='light'
                          type='warning'
                          onClick={() => setGroup(g)}
                        >
                          {g}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Text size='small' type='tertiary' className='block mt-1'>
                      {t('您的所有可用分组均无图像模型，请联系管理员开通。')}
                    </Text>
                  )}
                </div>
              );
            })()}

            {/* Prompt - 主角 */}
            <div>
              <div className='flex items-center justify-between mb-1'>
                <Text strong>{t('提示词')}</Text>
                <Text size='small' type='tertiary'>{prompt.length}/4000</Text>
              </div>
              <TextArea
                value={prompt}
                onChange={setPrompt}
                rows={6}
                maxLength={4000}
                showClear
                autosize={{ minRows: 6, maxRows: 14 }}
                placeholder={t('描述你想要的画面…')}
              />
              <div className='flex flex-wrap gap-1.5 mt-2'>
                {PROMPT_PRESETS.map((p, i) => (
                  <Tooltip key={i} content={p}>
                    <Tag
                      color='violet'
                      type='light'
                      onClick={() => setPrompt(p)}
                      className='cursor-pointer'
                    >
                      ✨ {t('灵感')} {i + 1}
                    </Tag>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* 图生图：参考图上传 */}
            {mode === 'i2i' && (
              <div>
                <div className='flex items-center justify-between mb-2'>
                  <Text strong>
                    {t('参考图')}{' '}
                    <Text type='tertiary' size='small'>
                      ({refFiles.length}/6)
                    </Text>
                  </Text>
                  {refFiles.length > 0 && (
                    <Button
                      size='small'
                      type='tertiary'
                      onClick={() => setRefFiles([])}
                    >
                      {t('清空')}
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  multiple
                  className='hidden'
                  onChange={onPickFiles}
                />
                <div className='grid grid-cols-3 gap-2'>
                  {refPreviews.map((src, idx) => (
                    <div
                      key={idx}
                      className='group relative aspect-square rounded-lg overflow-hidden border border-semi-color-border bg-semi-color-bg-2'
                    >
                      <img
                        src={src}
                        alt=''
                        className='w-full h-full object-cover'
                      />
                      <button
                        onClick={() => removeRef(idx)}
                        className='absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center'
                        type='button'
                      >
                        <IconClose size='small' />
                      </button>
                    </div>
                  ))}
                  {refFiles.length < 6 && (
                    <button
                      type='button'
                      onClick={() => fileInputRef.current?.click()}
                      className='aspect-square rounded-lg border-2 border-dashed border-semi-color-border hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/10 flex flex-col items-center justify-center text-semi-color-text-2 transition'
                    >
                      <IconPlus size='large' />
                      <span className='text-xs mt-1'>{t('添加')}</span>
                    </button>
                  )}
                </div>
                <Text type='tertiary' size='small' className='block mt-2'>
                  {t('支持上传 1–6 张图，作为生成的视觉参考')}
                </Text>
                <Text type='tertiary' size='small' className='block mt-1'>
                  {t('💡 也可直接 Ctrl/⌘+V 粘贴 或 拖拽图片到页面')}
                </Text>
              </div>
            )}

            {/* 参数 - 横排 chip 化 */}
            {sizePrices ? (
              <>
                <div>
                  <Text size='small' type='tertiary'>{t('分辨率')}</Text>
                  <div className='flex gap-2 mt-1 flex-wrap'>
                    {TIER_KEYS.map((tier) => {
                      const enabled =
                        typeof sizePrices[tier] === 'number' && sizePrices[tier] > 0;
                      const active = currentTier === tier;
                      return (
                        <button
                          key={tier}
                          type='button'
                          disabled={!enabled}
                          onClick={() => applyTierAspect(tier, currentAspect)}
                          className={[
                            'px-3 py-1.5 rounded-lg text-xs border transition flex flex-col items-center min-w-[64px]',
                            active
                              ? 'bg-purple-500 border-purple-500 text-white'
                              : enabled
                                ? 'bg-semi-color-bg-2 border-semi-color-border hover:border-purple-400'
                                : 'bg-semi-color-bg-1 border-semi-color-border opacity-40 cursor-not-allowed',
                          ].join(' ')}
                        >
                          <span className='font-semibold'>{tier}</span>
                          {enabled && tierEstimates && tierEstimates[tier] != null && (
                            <span className='text-[10px] opacity-80 mt-0.5'>
                              ≈ {renderQuota(tierEstimates[tier], 4)}
                            </span>
                          )}
                          {!enabled && (
                            <span className='text-[10px] opacity-60 mt-0.5'>
                              {t('未配置')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className='grid grid-cols-2 gap-3'>
                  <div>
                    <Text size='small' type='tertiary'>{t('比例')}</Text>
                    <Select
                      className='!w-full mt-1'
                      value={currentAspect}
                      onChange={(v) => applyTierAspect(currentTier, v)}
                      optionList={ASPECT_KEYS.map((a) => ({
                        label: t(a.label),
                        value: a.key,
                      }))}
                    />
                  </div>
                  <div>
                    <Text size='small' type='tertiary'>{t('数量')}</Text>
                    <InputNumber
                      className='!w-full mt-1'
                      min={1}
                      max={4}
                      step={1}
                      value={n}
                      onChange={(v) => setN(Number(v) || 1)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <Text size='small' type='tertiary'>{t('比例')}</Text>
                  <Select
                    className='!w-full mt-1'
                    value={size}
                    onChange={setSize}
                    optionList={ASPECT_OPTIONS}
                  />
                </div>
                <div>
                  <Text size='small' type='tertiary'>{t('数量')}</Text>
                  <InputNumber
                    className='!w-full mt-1'
                    min={1}
                    max={4}
                    step={1}
                    value={n}
                    onChange={(v) => setN(Number(v) || 1)}
                  />
                </div>
              </div>
            )}

            {/* 费用预估 */}
            <div className='flex items-center justify-between rounded-xl px-3 py-2 bg-gradient-to-r from-amber-50 to-rose-50 dark:from-amber-900/20 dark:to-rose-900/20 border border-amber-200/60 dark:border-amber-800/40'>
              <div className='flex items-center gap-2'>
                <span className='text-amber-600 dark:text-amber-300'>💰</span>
                <Text size='small' type='secondary'>
                  {t('预计本次消耗')}
                </Text>
              </div>
              <Tooltip
                content={
                  estimatedQuota != null
                    ? t(
                        '基于 模型价 × 分组倍率({{gr}}) × 尺寸系数({{sr}}) × 张数({{n}}) 估算，实际以上游返回为准',
                        {
                          gr: (groupRatioMap[group] ?? 1).toString(),
                          sr: computeSizeRatio(model, size).toString(),
                          n,
                        },
                      )
                    : t('暂无该模型价格信息，将按上游实际用量结算')
                }
              >
                <Text strong style={{ color: estimatedQuota != null ? '#e11d48' : undefined }}>
                  {estimatedQuota != null
                    ? `≈ ${renderQuota(estimatedQuota, 4)}`
                    : t('未知')}
                </Text>
              </Tooltip>
            </div>

            {/* CTA */}
            <Button
              theme='solid'
              size='large'
              block
              loading={loading}
              disabled={!canGenerate}
              onClick={handleGenerate}
              icon={<IconBolt />}
              className='!h-12 !rounded-xl !text-base !font-semibold !bg-gradient-to-r !from-indigo-500 !via-purple-500 !to-pink-500 hover:!opacity-90'
            >
              {loading ? t('生成中…') : t('生成图像')}
            </Button>

            <Text type='tertiary' size='small' className='leading-relaxed'>
              {t('计费按上游模型实际用量结算，分组倍率会影响最终扣费。')}
            </Text>
          </div>
        </div>

        {/* 画廊 */}
        <div className='rounded-2xl border border-semi-color-border bg-semi-color-bg-1 shadow-sm min-h-[60vh] p-4'>
          {loading && results.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-32 gap-4'>
              <Spin size='large' />
              <Text type='tertiary'>{t('正在生成，请稍候…')}</Text>
              <div className='flex gap-1.5'>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className='w-2 h-2 rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 animate-pulse'
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className='flex items-center justify-center py-24'>
              <Empty
                image={
                  <div className='w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 dark:from-indigo-900/40 dark:via-purple-900/40 dark:to-pink-900/40 flex items-center justify-center'>
                    <IconImage size='extra-large' className='text-purple-500' />
                  </div>
                }
                title={
                  <span className='text-base font-medium'>{t('开启你的创作')}</span>
                }
                description={t('在左侧写下提示词，点击「生成图像」开始')}
              />
            </div>
          ) : (
            <div className='grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
              {results.map((it) => (
                <div
                  key={it.id}
                  className='group relative rounded-xl overflow-hidden bg-semi-color-bg-2 border border-semi-color-border hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200'
                >
                  <div className='relative aspect-square bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900'>
                    <Image
                      src={it.src}
                      width='100%'
                      height='100%'
                      style={{ objectFit: 'cover' }}
                      preview
                    />
                    {/* hover 工具条 */}
                    <div className='absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
                      <Tooltip content={t('用作参考图（图生图）')}>
                        <Button
                          size='small'
                          icon={<IconImage />}
                          onClick={() => useAsReference(it)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                      <Tooltip content={t('复用提示词')}>
                        <Button
                          size='small'
                          icon={<IconCopy />}
                          onClick={() => reusePrompt(it)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                      <Tooltip content={t('下载')}>
                        <Button
                          size='small'
                          icon={<IconDownload />}
                          onClick={() => downloadOne(it)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                      <Tooltip content={t('移除')}>
                        <Button
                          size='small'
                          icon={<IconClose />}
                          onClick={() => removeOne(it.id)}
                          className='!backdrop-blur !bg-white/70 dark:!bg-black/50'
                        />
                      </Tooltip>
                    </div>
                  </div>
                  <div className='p-3'>
                    <Text
                      ellipsis={{ showTooltip: true, rows: 2 }}
                      className='!text-[13px] !leading-snug'
                    >
                      {it.prompt}
                    </Text>
                    <div className='flex items-center gap-1 mt-2 flex-wrap'>
                      <Tag size='small' color='blue' type='light'>{it.model}</Tag>
                      <Tag size='small' color='grey' type='light'>{it.size}</Tag>
                      {it.mode === 'i2i' && (
                        <Tag size='small' color='purple' type='light'>i2i</Tag>
                      )}
                      {it.cost != null ? (
                        <Tooltip
                          content={
                            it.batchSize > 1
                              ? t('本次共 {{n}} 张，合计 {{c}}', {
                                  n: it.batchSize,
                                  c: renderQuota(it.cost, 4),
                                })
                              : t('本次消耗 {{c}}', {
                                  c: renderQuota(it.cost, 4),
                                })
                          }
                        >
                          <Tag size='small' color='red' type='light'>
                            {renderQuota(
                              it.batchSize > 1 ? it.cost / it.batchSize : it.cost,
                              4,
                            )}
                          </Tag>
                        </Tooltip>
                      ) : (
                        <Tag size='small' color='grey' type='ghost'>
                          {t('计费中…')}
                        </Tag>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageStudio;
