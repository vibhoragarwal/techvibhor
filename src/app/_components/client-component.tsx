// src/app/client-component.tsx
"use client";
import Prism from 'prismjs';
//import 'prismjs/components/prism-bash';
//import 'prismjs/plugins/command-line/prism-command-line';
//import 'prismjs/plugins/command-line/prism-command-line.css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import './prism-okaidia.css'; // Scoped CSS
import { useEffect } from 'react';

export default function ClientComponent({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    Prism.highlightAll();
  }, []);

  return  <div className="prism-code">{children}</div>;
}