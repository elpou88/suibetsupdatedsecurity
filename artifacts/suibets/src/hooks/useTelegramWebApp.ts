import { useEffect, useState, useCallback } from 'react';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

interface TMAMainButton {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  show: () => void;
  hide: () => void;
  enable: () => void;
  disable: () => void;
  setText: (text: string) => void;
  onClick: (fn: () => void) => void;
  offClick: (fn: () => void) => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
  setParams: (params: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) => void;
}

interface TMABackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (fn: () => void) => void;
  offClick: (fn: () => void) => void;
}

interface TMAHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => TMAHapticFeedback;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => TMAHapticFeedback;
  selectionChanged: () => TMAHapticFeedback;
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  colorScheme: 'light' | 'dark';
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    chat_instance?: string;
    chat_type?: string;
    start_param?: string;
    auth_date?: number;
    hash?: string;
  };
  MainButton: TMAMainButton;
  BackButton: TMABackButton;
  HapticFeedback: TMAHapticFeedback;
  version: string;
  platform: string;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  isVersionAtLeast: (version: string) => boolean;
  sendData: (data: string) => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  showPopup: (params: { title?: string; message: string; buttons?: Array<{ id?: string; type?: string; text?: string }> }, callback?: (buttonId: string) => void) => void;
  showAlert: (message: string, callback?: () => void) => void;
  showConfirm: (message: string, callback?: (confirmed: boolean) => void) => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  enableClosingConfirmation: () => void;
  disableClosingConfirmation: () => void;
  onEvent: (eventType: string, eventHandler: () => void) => void;
  offEvent: (eventType: string, eventHandler: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.Telegram?.WebApp;
}

export function useTelegramWebApp() {
  const twa = getTelegramWebApp();
  const isInTelegram = !!(twa && twa.initData);

  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>(
    twa?.colorScheme ?? 'dark'
  );
  const [viewportHeight, setViewportHeight] = useState(
    twa?.viewportStableHeight ?? window.innerHeight
  );

  useEffect(() => {
    if (!twa || !isInTelegram) return;

    twa.ready();
    twa.expand();

    const handleThemeChange = () => setColorScheme(twa.colorScheme);
    const handleViewportChange = () => setViewportHeight(twa.viewportStableHeight);

    twa.onEvent('themeChanged', handleThemeChange);
    twa.onEvent('viewportChanged', handleViewportChange);

    return () => {
      twa.offEvent('themeChanged', handleThemeChange);
      twa.offEvent('viewportChanged', handleViewportChange);
    };
  }, [twa, isInTelegram]);

  const hapticImpact = useCallback((style: 'light' | 'medium' | 'heavy' = 'medium') => {
    twa?.HapticFeedback?.impactOccurred(style);
  }, [twa]);

  const hapticSuccess = useCallback(() => {
    twa?.HapticFeedback?.notificationOccurred('success');
  }, [twa]);

  const hapticError = useCallback(() => {
    twa?.HapticFeedback?.notificationOccurred('error');
  }, [twa]);

  return {
    isInTelegram,
    twa,
    user: twa?.initDataUnsafe?.user,
    colorScheme,
    viewportHeight,
    initData: twa?.initData ?? '',
    startParam: twa?.initDataUnsafe?.start_param,
    platform: twa?.platform ?? 'unknown',
    hapticImpact,
    hapticSuccess,
    hapticError,
  };
}
