import { COLORS } from '@/theme/colors';
import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.yellow,
          padding: 24,
        }}
      >
        <View
          style={{
            width: '100%',
            backgroundColor: COLORS.black,
            borderRadius: 24,
            padding: 32,
            alignItems: 'center',
            gap: 16,
            shadowColor: COLORS.black,
            shadowOffset: { width: 0, height: 16 },
            shadowOpacity: 0.4,
            shadowRadius: 32,
            elevation: 16,
          }}
        >
          <Text
            style={{
              fontSize: 48,
              fontWeight: '800',
              color: COLORS.yellow,
              letterSpacing: -1,
            }}
          >
            404
          </Text>

          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text
              style={{
                fontSize: 20,
                fontWeight: '800',
                color: COLORS.white,
                letterSpacing: -0.5,
              }}
            >
              Page not found
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: COLORS.inputLabel,
                textAlign: 'center',
              }}
            >
              The screen you're looking for doesn't exist.
            </Text>
          </View>

          {/* Divider */}
          <View
            style={{
              width: '100%',
              height: 1,
              backgroundColor: COLORS.divider,
            }}
          />

          <Link href='/' asChild>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '800',
                color: COLORS.black,
                backgroundColor: COLORS.yellow,
                paddingHorizontal: 32,
                paddingVertical: 14,
                borderRadius: 100,
                overflow: 'hidden',
                letterSpacing: 0.3,
              }}
            >
              Go to Home
            </Text>
          </Link>
        </View>
      </View>
    </>
  );
}
