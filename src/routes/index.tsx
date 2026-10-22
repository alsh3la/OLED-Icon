import { createFileRoute } from "@tanstack/react-router";
import { IconMaker } from "@/components/icon-maker/app";

export const Route = createFileRoute("/")({
  component: IconMaker,
});
