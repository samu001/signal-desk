import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Theme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { TradingProvider } from '@/context/TradingContext';
import { palette } from '@/constants/theme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

const AppTheme: Theme = {
  dark: false,
  colors: {
    primary: palette.moss,
    background: palette.paper,
    card: palette.paper,
    text: palette.ink,
    border: palette.line,
    notification: palette.leaf,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <TradingProvider>
      <ThemeProvider value={AppTheme}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.paper },
            headerTintColor: palette.ink,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: palette.paper },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="trade-plan" options={{ title: 'Trade plan', presentation: 'modal' }} />
          <Stack.Screen name="trade-detail" options={{ title: 'Trade' }} />
          <Stack.Screen name="setup-detail" options={{ title: 'Setup' }} />
          <Stack.Screen
            name="watchlist-form"
            options={{ title: 'Watchlist', presentation: 'modal' }}
          />
        </Stack>
      </ThemeProvider>
    </TradingProvider>
  );
}
