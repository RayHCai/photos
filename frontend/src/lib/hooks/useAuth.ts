'use client';

import { AuthContext } from '../providers/AuthProvider';
import { createContextHook } from '../utils/createContextHook';

export const useAuth = createContextHook(AuthContext, 'useAuth');
