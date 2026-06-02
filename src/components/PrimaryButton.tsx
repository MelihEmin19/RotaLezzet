import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

type Props = {
  label: string;
  loading?: boolean;
} & Omit<PressableProps, "children">;

export function PrimaryButton({ label, disabled, loading, ...props }: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className={[
        "h-12 w-full flex-row items-center justify-center rounded-2xl px-5",
        isDisabled ? "bg-zinc-200" : "bg-zinc-900",
      ].join(" ")}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={isDisabled ? "#3f3f46" : "#ffffff"} />
      ) : (
        <Text className={isDisabled ? "text-zinc-600" : "text-white"} style={{ fontWeight: "600" }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

