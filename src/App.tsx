import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [greeting, setGreeting] = useState<string | null>(null);

  async function handleGreet() {
    const msg = await invoke<string>("greet", { name: "STL Browser" });
    setGreeting(msg);
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center gap-6 p-10 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">STL Browser</h1>
      <button
        onClick={handleGreet}
        className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-400 active:bg-indigo-600 transition-colors"
      >
        Greet from Rust
      </button>
      {greeting && (
        <p className="text-sm text-neutral-400">{greeting}</p>
      )}
    </main>
  );
}

export default App;
