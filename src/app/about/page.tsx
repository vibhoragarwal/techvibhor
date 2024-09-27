import Container from "@/app/_components/container";
import Header from "@/app/_components/header";
import fs from "fs";
import matter from "gray-matter";
import { join } from "path";
import markdownStyles from "./markdown-styles.module.css";
import { Aladin } from "next/font/google";
import Alert from "../_components/alert";
const aboutDirectory = join(process.cwd(), "_about");

import markdownToHtml from "@/lib/markdownToHtml";
import Link from "next/link";

export default async function About() {


  const fullPath = join(aboutDirectory, `about.md`);
  const fileContents = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(fileContents);


  const content_html = await markdownToHtml(content || "");

  return (
    <main>
      <Alert></Alert>
      <Container>
        <Header />
    <div className="max-w-2xl mx-auto">
      <div
        className={markdownStyles["markdown"]}
        dangerouslySetInnerHTML={{ __html: content_html }}
      />
   
    <Link href="/VibhorResume 1.5.pdf" target="_blank">
    <h2 className="mb-8 text-xl md:text-2xl font-bold tracking-tighter leading-tight hover:underline">
        Download Resume
      </h2>
      </Link>

      <Link href="https://www.linkedin.com/in/vibhoragarwaltechfree/" target="_blank">
    <h2 className="mb-8 text-xl md:text-2xl font-bold tracking-tighter leading-tight hover:underline">
       Linkedin
      </h2>
      </Link>
      </div>
      </Container>
    </main>
  );
}
