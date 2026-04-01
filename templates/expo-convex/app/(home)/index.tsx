import { COLORS } from '@/theme/colors';
import { Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.yellow,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Text
        style={{
          fontSize: 32,
          fontWeight: '800',
          color: COLORS.black,
          letterSpacing: -0.5,
        }}
      >
        Home
      </Text>
    </View>
  );
}
