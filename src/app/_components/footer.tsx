import Container from "@/app/_components/container";
import { EXAMPLE_PATH } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="bg-neutral-50 border-t border-neutral-200 dark:bg-slate-800">
      <Container>
        <div className="py-20 flex flex-col lg:flex-row items-center">
          <h1 className="text-xl lg:text-[1.5rem] font-bold tracking-tighter leading-tight text-center lg:text-left mb-10 lg:mb-0 lg:pr-4 lg:w-1/2">
          Content Copyright (c) 2024 Vibhor Agarwal
          </h1>
          <a
              href={`https://github.com/vercel/next.js/blob/canary/license.md`}
              className="mx-3 font-bold hover:underline"
            >
            Next.js Template License
              </a>
          <div className="flex flex-col lg:flex-row justify-center items-center lg:pl-4 lg:w-1/2">
            {/* <a
              href="https://nextjs.org/docs/app/building-your-application/routing/layouts-and-templates"
              className="mx-3 bg-black hover:bg-white hover:text-black border border-black text-white font-bold py-3 px-12 lg:px-8 duration-200 transition-colors mb-6 lg:mb-0"
            >
              Read Documentation
            </a> */}
            <a
              href={`https://www.linkedin.com/in/vibhoragarwaltechfree/`}
              className="mx-3 font-bold hover:underline"
            >
              Connect @LinkedIn
            </a>
          </div>
              
        </div>

      </Container>
    </footer>
  );
}

export default Footer;
