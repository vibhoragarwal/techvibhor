import Container from "@/app/_components/container";
import { EXAMPLE_PATH } from "@/lib/constants";
import cn from "classnames";

type Props = {
  preview?: boolean;
};

const Alert = ({ preview }: Props) => {
  return (
    <div
      className={cn("border-b dark:bg-slate-800", {
        "bg-neutral-800 border-neutral-800 text-white": preview,
        "bg-neutral-50 border-neutral-200": !preview,
      })}
    >
      <Container>
        <div className="py-2 text-center text-sm">
          {preview ? (
            <>
              This page is a preview.{" "}
              <a
                href="/api/exit-preview"
                className="underline hover:text-teal-300 duration-200 transition-colors"
              >
                Click here
              </a>{" "}
              to exit preview mode.
            </>
          ) : (
            <>
            Follow me at: <span> </span>
              <a
                href={`https://www.linkedin.com/in/vibhoragarwaltechfree/`}
                className="underline hover:text-blue-600 duration-200 transition-colors"
              >
               Linkedin   <span> </span> 
              </a>
              or at:  <span> </span>
              <a
                href={`https://stackoverflow.com/users/7746398/techfree`}
                className="underline hover:text-blue-600 duration-200 transition-colors"
              >
              stackoverflow
              </a>
            </>
          )}
        </div>
      </Container>
    </div>
  );
};

export default Alert;
