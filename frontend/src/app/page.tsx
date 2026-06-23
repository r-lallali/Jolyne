import { Conversation } from "@/components/Conversation";
import TrackPageView from "@/components/TrackPageView";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-stretch justify-center sm:items-center sm:px-4 sm:py-8">
      <TrackPageView />
      <Conversation />
    </main>
  );
}
