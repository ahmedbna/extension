import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import { Loader2 } from 'lucide-react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '@/theme/colors';

type SpinnerSize = 'sm' | 'default' | 'lg' | 'icon';

interface SpinnerProps {
  size?: SpinnerSize;
  style?: ViewStyle;
  color?: string;
  speed?: 'slow' | 'normal' | 'fast';
}

const sizeConfig: Record<SpinnerSize, { size: number }> = {
  sm: { size: 16 },
  default: { size: 24 },
  lg: { size: 32 },
  icon: { size: 24 },
};

const speedConfig: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 1500,
  normal: 1000,
  fast: 500,
};

export function Spinner({
  size = 'default',
  style,
  color = COLORS.black,
  speed = 'normal',
}: SpinnerProps) {
  const rotate = useSharedValue(0);
  const { size: iconSize } = sizeConfig[size];
  const duration = speedConfig[speed];

  useEffect(() => {
    rotate.value = withRepeat(
      withTiming(360, { duration, easing: Easing.linear }),
      -1,
    );
  }, [rotate, duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }],
  }));

  return (
    <View
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          { width: iconSize, height: iconSize },
          {
            alignItems: 'center',
            justifyContent: 'center',
          },
          animatedStyle,
        ]}
      >
        <Loader2 size={iconSize} color={color} />
      </Animated.View>
    </View>
  );
}
