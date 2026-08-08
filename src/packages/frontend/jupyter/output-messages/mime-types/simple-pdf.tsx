import register from "./register";
import { PDF } from "../pdf";

register("application/pdf", 6, ({ value, actions }) => {
  if (value == null) {
    console.warn("PDF: value must be specified");
    return <pre>Invalid PDF output</pre>;
  }
  return <PDF value={value} actions={actions} />;
});
