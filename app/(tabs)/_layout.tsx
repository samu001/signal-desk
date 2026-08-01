import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { palette } from '@/constants/theme';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  useColorScheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.paper },
        headerTitleStyle: { fontWeight: '700', color: palette.ink },
        headerShadowVisible: false,
        tabBarActiveTintColor: palette.moss,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: {
          backgroundColor: palette.paper,
          borderTopColor: palette.line,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <TabBarIcon name="sun-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="playbook"
        options={{
          title: 'Playbook',
          tabBarIcon: ({ color }) => <TabBarIcon name="book" color={color} />,
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: 'Watchlist',
          tabBarIcon: ({ color }) => <TabBarIcon name="eye" color={color} />,
        }}
      />
      <Tabs.Screen
        name="journal"
        options={{
          title: 'Journal',
          tabBarIcon: ({ color }) => <TabBarIcon name="list-alt" color={color} />,
        }}
      />
    </Tabs>
  );
}
