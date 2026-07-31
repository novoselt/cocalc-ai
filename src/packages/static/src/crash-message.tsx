export default function CrashMessage({
  msg,
  lineNo,
  columnNo,
  url,
  stack,
  showLoadFail,
}) {
  return (
    <div>
      <div>
        <strong>Application Error:</strong>{" "}
        <code>
          {msg} @ {lineNo}/{columnNo} of {url}
        </code>
      </div>
      <div
        style={{
          border: "1px solid lightgrey",
          margin: "30px 0",
          padding: "15px",
          background: "white",
          borderRadius: "5px",
        }}
      >
        {showLoadFail && <h3>CoCalc Failed to Load</h3>}
        <b>This error was reported automatically.</b> In the meantime, try
        reloading this browser tab or{" "}
        <a
          onClick={() => {
            const crash = document.getElementById("cocalc-react-crash");
            if (crash == null) return;
            crash.style.display = "none";
          }}
        >
          dismissing this message
        </a>{" "}
        and continuing.
      </div>
      <pre style={{ overflow: "auto", marginTop: "15px", background: "white" }}>
        {stack}
      </pre>
    </div>
  );
}
