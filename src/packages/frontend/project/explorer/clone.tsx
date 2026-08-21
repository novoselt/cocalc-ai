import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Button, Checkbox, Input, Popconfirm, Spin } from "antd";
import { Tooltip } from "@cocalc/frontend/components";
import { Icon } from "@cocalc/frontend/components/icon";
import { ProjectTitle } from "@cocalc/frontend/projects/project-title";
import { redux } from "@cocalc/frontend/app-framework";
import ShowError from "@cocalc/frontend/components/error";
import { useIntl } from "react-intl";
import { labels } from "@cocalc/frontend/i18n";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";

interface Props {
  project_id: string;
  flyout?: boolean;
  disabled?: boolean;
}

export default function CloneProject({ project_id, flyout, disabled }: Props) {
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<any>(null);
  const titleRef = useRef<string>("");
  const grantVmAccessRef = useRef(false);
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();
  const intl = useIntl();
  const projectLabelLower = intl.formatMessage(labels.project).toLowerCase();
  return (
    <>
      <Popconfirm
        title={
          <div style={{ maxWidth: "450px" }}>
            Create a clone of "<ProjectTitle project_id={project_id} noClick />"
          </div>
        }
        description={() => (
          <>
            <Description
              project_id={project_id}
              titleRef={titleRef}
              grantVmAccessRef={grantVmAccessRef}
              projectLabelLower={projectLabelLower}
            />
            <ShowError error={error} setError={setError} />
          </>
        )}
        onConfirm={async () => {
          try {
            setSaving(true);
            setError("");
            const clone = async () => {
              await redux.getActions("projects").cloneProject({
                project_id,
                title: titleRef.current,
                grant_compute_vm_access: grantVmAccessRef.current,
              });
            };
            if (grantVmAccessRef.current) {
              await runFreshAuthAction(clone);
            } else {
              await clone();
            }
          } catch (err) {
            setError(err);
          } finally {
            setSaving(false);
          }
        }}
        okText="Create Clone"
        cancelText="Cancel"
      >
        <span>
          <Tooltip
            title={
              <>
                Cloning will copy "
                <ProjectTitle project_id={project_id} noClick />
                ", including changes to the root filesystem / (e.g., systemwide
                software install) and TimeTravel edit history, but without
                collaborators.
              </>
            }
            mouseEnterDelay={0}
            mouseLeaveDelay={0}
          >
            <Button disabled={saving || disabled}>
              <Icon name="fork-outlined" />
              {!flyout && <> Clone</>}
              {saving && (
                <>
                  {" "}
                  <Spin />
                </>
              )}
            </Button>
          </Tooltip>
        </span>
      </Popconfirm>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}

function Description({
  project_id,
  titleRef,
  grantVmAccessRef,
  projectLabelLower,
}: {
  project_id: string;
  titleRef: MutableRefObject<string>;
  grantVmAccessRef: MutableRefObject<boolean>;
  projectLabelLower: string;
}) {
  const [title, setTitle] = useState<string>(
    `Clone of ${
      redux.getStore("projects").getIn(["project_map", project_id, "title"]) ??
      projectLabelLower
    }`,
  );
  useEffect(() => {
    titleRef.current = title;
  }, []);
  return (
    <div style={{ maxWidth: "500px" }}>
      A clone is a copy of a {projectLabelLower}, both the HOME directory and
      customizations to the root filesystem /. Cloning a {projectLabelLower}{" "}
      allows you to make changes without affecting the original{" "}
      {projectLabelLower}. Project secrets are copied to the clone. Snapshots
      and collaborators are not included.
      <Input
        placeholder="Title of clone... (you can change this later)"
        allowClear
        style={{ marginTop: "5px" }}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          titleRef.current = e.target.value;
        }}
      />
      <Checkbox
        onChange={(event) => {
          grantVmAccessRef.current = event.target.checked;
        }}
        style={{ marginTop: 12 }}
      >
        Also grant this cloned project SSH access to the same account-owned
        virtual machines. A new project-specific SSH identity will be created.
      </Checkbox>
    </div>
  );
}
