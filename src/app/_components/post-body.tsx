import markdownStyles from "./markdown-styles.module.css";
import ClientComponent from './client-component'
type Props = {
  content: string;
};

export function PostBody({ content }: Props) {
  return (
       <ClientComponent>
            <div className="max-w-3xl mx-auto">
              <div
                className={markdownStyles["markdown"]}
                dangerouslySetInnerHTML={{ __html: content }}
              />
            </div>
     </ClientComponent>
  );
}
