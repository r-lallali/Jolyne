"use client";

import { useRouter } from "next/navigation";
import { use } from "react";
import { FriendConversation } from "@/components/friends/FriendConversation";

export default function FriendChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id: idStr } = use(params);
  const id = Number(idStr);
  return (
    <main className="h-dvh w-full">
      <FriendConversation
        friendId={id}
        onBack={() => router.push("/chats")}
        onLeft={() => router.push("/chats")}
      />
    </main>
  );
}
