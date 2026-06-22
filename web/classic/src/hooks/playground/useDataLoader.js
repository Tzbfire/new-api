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

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API,
  processModelsData,
  processGroupsData,
  showError,
} from '../../helpers';
import { API_ENDPOINTS } from '../../constants/playground.constants';

export const useDataLoader = (
  userState,
  inputs,
  handleInputChange,
  setModels,
  setGroups,
) => {
  const { t } = useTranslation();
  const hasInitializedRef = useRef(false);

  const loadModels = useCallback(
    async ({ group = '', currentModel = '', notifyOnFallback = false } = {}) => {
      try {
        const normalizedGroup = group || '';
        const query = normalizedGroup
          ? `?group=${encodeURIComponent(normalizedGroup)}`
          : '';
        const res = await API.get(`${API_ENDPOINTS.USER_MODELS}${query}`);
        const { success, message, data } = res.data;

        if (success) {
          const { modelOptions, selectedModel, hasCurrentModel } =
            processModelsData(data, currentModel);
          setModels(modelOptions);

          if (
            notifyOnFallback &&
            !hasCurrentModel &&
            currentModel &&
            selectedModel !== currentModel
          ) {
            showError(t('当前分组不包含已选模型，已自动切换到可用模型'));
          }

          if ((selectedModel || '') !== (currentModel || '')) {
            handleInputChange('model', selectedModel || '');
          }

          return { modelOptions, selectedModel };
        }

        showError(t(message));
      } catch (error) {
        showError(t('加载模型失败'));
      }

      setModels([]);
      if (currentModel) {
        handleInputChange('model', '');
      }
      return { modelOptions: [], selectedModel: '' };
    },
    [handleInputChange, setModels, t],
  );

  const loadGroups = useCallback(
    async (currentGroup = '') => {
      try {
        const res = await API.get(API_ENDPOINTS.USER_GROUPS);
        const { success, message, data } = res.data;

        if (success) {
          const userGroup =
            userState?.user?.group ||
            JSON.parse(localStorage.getItem('user'))?.group;
          const groupOptions = processGroupsData(data, userGroup);
          setGroups(groupOptions);

          const hasCurrentGroup = groupOptions.some(
            (option) => option.value === currentGroup,
          );
          const selectedGroup = hasCurrentGroup
            ? currentGroup
            : groupOptions[0]?.value || '';

          if ((selectedGroup || '') !== (currentGroup || '')) {
            handleInputChange('group', selectedGroup);
          }

          return { groupOptions, selectedGroup };
        }

        showError(t(message));
      } catch (error) {
        showError(t('加载分组失败'));
      }

      setGroups([]);
      return { groupOptions: [], selectedGroup: '' };
    },
    [userState?.user?.group, handleInputChange, setGroups, t],
  );

  useEffect(() => {
    if (!userState?.user) {
      hasInitializedRef.current = false;
      return;
    }

    let disposed = false;
    const initializeData = async () => {
      const { selectedGroup } = await loadGroups(inputs.group);
      if (disposed) {
        return;
      }

      await loadModels({
        group: selectedGroup,
        currentModel: inputs.model,
        notifyOnFallback: true,
      });

      if (!disposed) {
        hasInitializedRef.current = true;
      }
    };

    initializeData();

    return () => {
      disposed = true;
    };
  }, [userState?.user?.id, userState?.user?.group, loadGroups, loadModels]);

  useEffect(() => {
    if (!userState?.user || !hasInitializedRef.current) {
      return;
    }

    loadModels({
      group: inputs.group,
      currentModel: inputs.model,
      notifyOnFallback: true,
    });
  }, [userState?.user?.id, inputs.group, loadModels]);

  return {
    loadModels,
    loadGroups,
  };
};
