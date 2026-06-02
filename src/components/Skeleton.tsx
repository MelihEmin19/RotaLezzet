import { View, type ViewProps } from "react-native";

type Props = {
  className?: string;
} & Omit<ViewProps, "className">;

export function Skeleton({ className, ...props }: Props) {
  return <View className={["bg-zinc-200", className].filter(Boolean).join(" ")} {...props} />;
}

