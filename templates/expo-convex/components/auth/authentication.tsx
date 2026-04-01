import { useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { Text, TextInput, View, Platform } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardToolbar,
} from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { COLORS } from '@/theme/colors';
import { Button } from '@/components/ui/button';

type AuthStep = 'signIn' | 'signUp';

// ─── Input ───────────────────────────────────────────────────────────
type InputProps = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  hasError: boolean;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  autoCorrect?: boolean;
  autoComplete?: string;
  editable?: boolean;
};

const Input = ({
  label,
  value,
  onChangeText,
  hasError,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  autoCorrect = true,
  autoComplete,
  editable = true,
}: InputProps) => {
  const [focused, setFocused] = useState(false);
  const floatAnim = useSharedValue(value ? 1 : 0);

  const handleFocus = () => {
    setFocused(true);
    floatAnim.value = withTiming(1, { duration: 180 });
    if (Platform.OS !== 'web') Haptics.selectionAsync();
  };

  const handleBlur = () => {
    setFocused(false);
    if (!value) floatAnim.value = withTiming(0, { duration: 180 });
  };

  const labelStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 22,
    top: interpolate(floatAnim.value, [0, 1], [18, 6]),
    fontSize: interpolate(floatAnim.value, [0, 1], [16, 11]),
    fontWeight: '500',
    color: hasError ? COLORS.red : focused ? COLORS.yellow : COLORS.inputLabel,
  }));

  const borderColor = hasError
    ? COLORS.red
    : focused
      ? COLORS.yellow
      : COLORS.inputBorder;

  return (
    <View
      style={{
        position: 'relative',
        borderRadius: 100,
        borderColor,
        borderWidth: focused || hasError ? 2 : 1.5,
        backgroundColor: COLORS.inputBg,
        height: 58,
        paddingHorizontal: 22,
        justifyContent: 'flex-end',
      }}
    >
      <Animated.Text style={labelStyle}>{label}</Animated.Text>
      <TextInput
        style={{
          fontSize: 16,
          color: COLORS.white,
          paddingBottom: 6,
          paddingTop: 18,
        }}
        value={value}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        autoComplete={autoComplete as any}
        editable={editable}
        placeholderTextColor='transparent'
        placeholder=' '
      />
    </View>
  );
};

export const Authentication = () => {
  const { signIn } = useAuthActions();

  const [step, setStep] = useState<AuthStep>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const slideAnim = useSharedValue(0);

  const resetFormState = () => {
    setEmail('');
    setPassword('');
    setError('');
    setLoading(false);
  };

  const changeStep = (newStep: AuthStep) => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    slideAnim.value = withSequence(
      withTiming(-10, { duration: 100 }),
      withTiming(0, { duration: 200 }),
    );
    resetFormState();
    setStep(newStep);
  };

  const validateEmail = (v: string) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError('Please enter a valid email address.');
      if (Platform.OS !== 'web')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
    setError('');
    return true;
  };

  const validatePassword = (v: string) => {
    if (v.length < 8 || !/\d/.test(v) || !/[a-z]/.test(v) || !/[A-Z]/.test(v)) {
      setError('Password must be 8+ chars with uppercase, lowercase & number.');
      if (Platform.OS !== 'web')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async () => {
    if (!validateEmail(email) || !validatePassword(password)) return;
    setLoading(true);
    setError('');
    try {
      await signIn('password', { email, password, flow: step });
      if (Platform.OS !== 'web')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (step === 'signUp') setPassword('');
    } catch (err: any) {
      console.error(`${step} error:`, err);
      setError('Authentication failed. Please check your credentials.');
      if (Platform.OS !== 'web')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.yellow }}>
      <KeyboardAwareScrollView
        bottomOffset={80}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: 72,
          paddingBottom: 40,
          alignItems: 'center',
          gap: 28,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <Image
          style={{ width: 110, height: 110 }}
          source={require('../../assets/images/splash-icon.png')}
          contentFit='contain'
          transition={600}
        />

        {/* Heading */}
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text
            style={{
              fontSize: 28,
              fontWeight: '800',
              color: COLORS.black,
              letterSpacing: -0.5,
            }}
          >
            {step === 'signIn' ? 'Welcome back' : 'Create account'}
          </Text>
          <Text
            style={{ fontSize: 15, color: COLORS.blackSoft, opacity: 0.55 }}
          >
            {step === 'signIn' ? 'Sign in to continue' : 'Get started for free'}
          </Text>
        </View>

        <View
          style={[
            {
              width: '100%',
              backgroundColor: COLORS.black,
              borderRadius: 24,
              padding: 24,
              gap: 16,
              shadowColor: COLORS.black,
              shadowOffset: { width: 0, height: 16 },
              shadowOpacity: 0.4,
              shadowRadius: 32,
              elevation: 16,
            },
          ]}
        >
          {/* Inputs */}
          <View style={{ gap: 14 }}>
            <Input
              label='Email address'
              value={email}
              onChangeText={setEmail}
              hasError={!!error}
              keyboardType='email-address'
              autoCapitalize='none'
              autoCorrect={false}
              autoComplete='email'
              editable={!loading}
            />
            <Input
              label='Password'
              value={password}
              onChangeText={setPassword}
              hasError={!!error}
              secureTextEntry
              autoComplete={
                step === 'signIn' ? 'current-password' : 'new-password'
              }
              editable={!loading}
            />
          </View>

          {/* Error */}
          {!!error && (
            <View
              style={{
                backgroundColor: COLORS.errorBg,
                borderRadius: 10,
                paddingVertical: 10,
                paddingHorizontal: 14,
              }}
            >
              <Text
                style={{
                  color: COLORS.red,
                  fontSize: 13,
                  fontWeight: '500',
                  textAlign: 'center',
                }}
              >
                {error}
              </Text>
            </View>
          )}

          <Button
            onPress={handleSubmit}
            disabled={loading}
            hapticStyle='medium'
            style={{
              backgroundColor: COLORS.yellow,
              borderRadius: 100,
              paddingVertical: 16,
              alignItems: 'center',
              shadowColor: COLORS.yellow,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 12,
              elevation: 6,
            }}
          >
            <Text
              style={{
                color: COLORS.black,
                fontSize: 16,
                fontWeight: '800',
                letterSpacing: 0.3,
              }}
            >
              {loading
                ? '···'
                : step === 'signIn'
                  ? 'Sign In'
                  : 'Create Account'}
            </Text>
          </Button>

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{ flex: 1, height: 1, backgroundColor: COLORS.divider }}
            />
            <Text
              style={{
                fontSize: 12,
                color: COLORS.dividerLabel,
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              or
            </Text>
            <View
              style={{ flex: 1, height: 1, backgroundColor: COLORS.divider }}
            />
          </View>

          {/* Guest */}
          <Button
            onPress={async () => {
              setLoading(true);
              await void signIn('anonymous');
              setLoading(false);
            }}
            hapticStyle='light'
            style={{
              borderRadius: 100,
              paddingVertical: 14,
              alignItems: 'center',
              backgroundColor: COLORS.green,
            }}
            disabled={loading}
          >
            <Text
              style={{
                color: COLORS.black,
                fontSize: 16,
                fontWeight: '800',
                letterSpacing: 0.3,
              }}
            >
              {loading ? '...' : 'Continue as Guest'}
            </Text>
          </Button>
        </View>

        {/* Step toggle */}
        <Button
          onPress={() => changeStep(step === 'signIn' ? 'signUp' : 'signIn')}
          style={{ paddingVertical: 8 }}
          hapticStyle='selection'
          disabled={loading}
        >
          <Text
            style={{
              fontSize: 14,
              color: COLORS.blackSoft,
              textAlign: 'center',
            }}
          >
            {step === 'signIn'
              ? "Don't have an account? "
              : 'Already have an account? '}
            <Text
              style={{
                fontWeight: '700',
                color: COLORS.black,
                textDecorationLine: 'underline',
              }}
            >
              {step === 'signIn' ? 'Sign Up' : 'Sign In'}
            </Text>
          </Text>
        </Button>
      </KeyboardAwareScrollView>

      <KeyboardToolbar
        content={<Text>Fill in the fields above</Text>}
        showArrows={true}
        doneText='Done'
      />
    </View>
  );
};
