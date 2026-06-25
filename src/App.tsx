import { useEffect } from "react";
import { Preview } from "./components/Preview";
import { Sidebar } from "./components/Sidebar";
import { decodeState, sampleImage, useStore } from "./store";

export default function App() {
  const setSource = useStore((s) => s.setSource);

  useEffect(() => {
    // hydrate pipeline from URL hash, if present
    const hash = location.hash.slice(1);
    if (hash) {
      const pipeline = decodeState(hash);
      if (pipeline) useStore.setState({ pipeline });
    }
    // start with the sample image
    const { el, w, h } = sampleImage();
    setSource(el, w, h, "sample");
  }, [setSource]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          cooltools<span className="caret">_</span>
        </div>
        <div className="tag">in-browser image effects · stack them live</div>
        <a className="src" href="https://www.tooooools.app" target="_blank" rel="noreferrer">
          inspired by tooooools
        </a>
      </header>
      <main className="layout">
        <Preview />
        <Sidebar />
      </main>
    </div>
  );
}
