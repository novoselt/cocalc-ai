import { buildMembershipTierPresentation } from "./membership-tier-presentation";
import { applyMembershipTierTemplateFallbacks } from "./membership-tier-templates";

describe("buildMembershipTierPresentation", () => {
  it("derives benefits, limits, and billing from a built-in paid tier", () => {
    const tier = applyMembershipTierTemplateFallbacks({ id: "pro" });
    const presentation = buildMembershipTierPresentation(tier);

    expect(presentation.tagline).toContain("Higher limits");
    expect(presentation.benefits).not.toContain("Internet-enabled projects.");
    expect(presentation.benefits).toContain(
      "Can rent custom project hosts with tier 2 host access.",
    );
    expect(presentation.summaryBenefits).toEqual(
      expect.arrayContaining([
        "Shared public project-host pool access, tier 2.",
        "Up to 16 simultaneous sponsored running projects.",
      ]),
    );
    expect(presentation.benefits).toContain(
      "Advanced OCI RootFS image import.",
    );
    expect(presentation.summaryLimits).toEqual(
      expect.arrayContaining([
        "Shared compute priority: 4",
        "Project RAM: 16 GB",
        "Per-project disk quota: 40 GB",
      ]),
    );
    expect(presentation.limits).toEqual(
      expect.arrayContaining([
        "Shared compute priority: 4",
        "Project RAM: 16 GB",
        "Per-project disk quota: 40 GB",
      ]),
    );
    expect(presentation.billing).toContain("$200.00 per month");
    expect(presentation.billing).toContain(
      "$1,800.00 per year (about 25% less than monthly)",
    );
    expect(presentation.detailGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "compute-projects",
          details: expect.arrayContaining([
            expect.objectContaining({
              key: "project_memory",
              value: "16 GB",
            }),
            expect.objectContaining({
              key: "shared_compute_priority",
              value: "4",
            }),
          ]),
        }),
        expect.objectContaining({
          key: "ai-automation",
          details: expect.arrayContaining([
            expect.objectContaining({ key: "ai_units_5h" }),
            expect.objectContaining({ key: "ai_units_7d" }),
          ]),
        }),
        expect.objectContaining({
          key: "collaboration",
          details: expect.arrayContaining([
            expect.objectContaining({
              key: "project_max_collaborators_and_pending_invites",
            }),
          ]),
        }),
        expect.objectContaining({
          key: "dedicated-hosts",
          details: expect.arrayContaining([
            expect.objectContaining({
              key: "create_hosts",
              value: "Yes",
            }),
          ]),
        }),
      ]),
    );
  });

  it("includes course-specific terms for course-visible tiers", () => {
    const tier = applyMembershipTierTemplateFallbacks({
      id: "student",
      course_store_visible: true,
    });
    const presentation = buildMembershipTierPresentation(tier);

    expect(presentation.billing).toContain(
      "Course option: $18.00 for 122 days.",
    );
    expect(presentation.billing).toContain("Course grace period: 10 days.");
  });

  it("falls back to a configured-tier tagline for custom tiers", () => {
    const presentation = buildMembershipTierPresentation({
      id: "custom",
      label: "Custom",
      project_defaults: { network: 1, memory: 2000, disk_quota: 5000 },
      usage_limits: {
        total_storage_hard_bytes: 125_000_000_000,
        max_sponsored_running_projects: 10,
      },
    });

    expect(presentation.tagline).toBe(
      "Membership benefits configured for Custom.",
    );
    expect(presentation.benefits).not.toContain("Internet-enabled projects.");
    expect(presentation.benefits).not.toContain(
      "Shared public project-host pool access, tier 0.",
    );
    expect(presentation.summaryBenefits).toContain(
      "Up to 10 simultaneous sponsored running projects.",
    );
    expect(presentation.summaryLimits).toEqual(
      expect.arrayContaining([
        "Total storage hard cap: 125 GB",
        "Project RAM: 2 GB",
        "Per-project disk quota: 5 GB",
      ]),
    );
    expect(presentation.limits).toContain("Project RAM: 2 GB");
  });

  it("formats exact rolling usage limits for user-facing comparisons", () => {
    const presentation = buildMembershipTierPresentation({
      id: "measured",
      ai_limits: { units_5h: 12.5, units_7d: 50 },
      project_defaults: { disk_quota: 25_000, memory: 12_000 },
      usage_limits: {
        cpu_5h_seconds: 18_000,
        cpu_7d_seconds: 252_000,
        egress_5h_bytes: 12_000_000_000,
        egress_7d_bytes: 125_000_000_000,
        total_storage_hard_bytes: 250_000_000_000,
      },
    });
    const details = presentation.detailGroups.flatMap((group) => group.details);

    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "cpu_5h_seconds",
          value: "5 CPU-hours",
        }),
        expect.objectContaining({
          key: "cpu_7d_seconds",
          value: "70 CPU-hours",
        }),
        expect.objectContaining({
          key: "egress_5h_bytes",
          value: "12 GB",
        }),
        expect.objectContaining({
          key: "egress_7d_bytes",
          value: "125 GB",
        }),
        expect.objectContaining({
          key: "total_storage_hard_bytes",
          value: "250 GB",
        }),
        expect.objectContaining({
          key: "ai_units_5h",
          value: "12.5 units",
        }),
      ]),
    );
  });
});
