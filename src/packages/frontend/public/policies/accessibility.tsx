import { A, type PublicPolicy } from "./policy";

export const accessibilityPolicy: PublicPolicy = {
  description: "Accessibility information, including VPAT-related material.",
  navLabel: "Accessibility",
  slug: "accessibility",
  title: "Accessibility Statement",
  updated: "August 10, 2026",
  content: (
    <>
      <p>
        Given the scope of what is possible in CoCalc, such as using arbitrary
        Jupyter notebooks with custom styling and a broad collection of software
        including user installed packages, it is infeasible to expect that
        everything will be fully accessible and aligned with any standards, such
        as WCAG. However, we are committed to do our best to resolve any
        concrete issues that our customers face. We have a long history of
        successfully facilitating courses for thousands of students (i.e. for
        users who cannot easily switch to an alternative platform) as evidence
        of success of this approach.
      </p>
      <p>
        If your use case is primarily to interact with Jupyter notebooks, keep
        in mind that CoCalc makes it easy to launch industry standard Jupyter
        Classic (and Jupyter Lab). These projects have put substantial
        deliberate efforts into making their products accessible, although they
        still do not claim to have AA compliance with WCAG.
      </p>
      <p>
        For more specific details, please consult our{" "}
        <A
          href="/public/documents/SageMathInc_ACR_VPAT2.5Rev_WCAG_August2026.html"
          rel="noopener"
          target="_blank"
        >
          Accessibility Conformance Report (based on VPAT® Version 2.5Rev)
        </A>{" "}
        (last updated August 2026). This report evaluates a representative
        sample of the current CoCalc.ai web application. Its scope, exclusions,
        evaluation methods, and limitations are described in the report.
      </p>
    </>
  ),
};

export default accessibilityPolicy;
