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
import { Navigate, useLocation } from 'react-router-dom';

function getLoginRedirectTarget(location) {
  const pathname = location?.pathname || '/console';
  const search = location?.search || '';
  const hash = location?.hash || '';
  const redirect = `${pathname}${search}${hash}`;
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

export function authHeader() {
  // return authorization header with jwt token
  let user = JSON.parse(localStorage.getItem('user'));

  if (user && user.token) {
    return { Authorization: 'Bearer ' + user.token };
  } else {
    return {};
  }
}

export const AuthRedirect = ({ children }) => {
  const user = localStorage.getItem('user');
  const location = useLocation();

  if (user) {
    const params = new URLSearchParams(location.search || '');
    const redirect = params.get('redirect');
    return (
      <Navigate
        to={redirect && redirect.startsWith('/') ? redirect : '/console'}
        replace
      />
    );
  }

  return children;
};

function PrivateRoute({ children }) {
  const location = useLocation();

  if (!localStorage.getItem('user')) {
    return <Navigate to={getLoginRedirectTarget(location)} replace />;
  }
  return children;
}

export function AdminRoute({ children }) {
  const raw = localStorage.getItem('user');
  const location = useLocation();

  if (!raw) {
    return <Navigate to={getLoginRedirectTarget(location)} replace />;
  }
  try {
    const user = JSON.parse(raw);
    if (user && typeof user.role === 'number' && user.role >= 10) {
      return children;
    }
  } catch (e) {
    // ignore
  }
  return <Navigate to='/forbidden' replace />;
}

export { PrivateRoute };
