import { ChatApp } from "@/components/chat/chat-app";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";

export default function Home() {
  return (
    <>
      <RegisterServiceWorker />
      <ChatApp />
    </>
  );
}
