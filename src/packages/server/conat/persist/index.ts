import { loadConatConfiguration } from "../configuration";
import {
  initPersistServer,
  initLoadBalancer,
} from "@cocalc/backend/conat/persist";
import { conatPersistCount } from "@cocalc/backend/data";
import { createForkedPersistServer } from "./start-server";
import getLogger from "@cocalc/backend/logger";
import { conat } from "@cocalc/backend/conat";
import { SERVICE as PERSIST_SERVICE } from "@cocalc/conat/persist/util";
import {
  createPersistMaintenanceCoordinator,
  type PersistMaintenanceCoordinator,
} from "@cocalc/backend/conat/persist-maintenance/coordinator";
import { loadPersistMaintenanceConfig } from "@cocalc/backend/conat/persist-maintenance/config";

const logger = getLogger("server:conat:persist");

export async function initConatPersist() {
  logger.debug("initPersistServer: sqlite3 stream persistence", {
    conatPersistCount,
  });
  const ids = Array.from(
    { length: Math.max(1, conatPersistCount || 1) },
    (_, index) => `${index}`,
  );
  const maintenanceConfig = loadPersistMaintenanceConfig();
  let maintenance: PersistMaintenanceCoordinator | undefined;
  if (maintenanceConfig.enabled) {
    try {
      maintenance = createPersistMaintenanceCoordinator({
        expectedWorkerIds: ids,
        config: maintenanceConfig,
      });
      maintenance.start();
    } catch (err) {
      logger.error("failed starting persist maintenance coordinator", err);
    }
  }
  if (!conatPersistCount || conatPersistCount <= 1) {
    // only 1, so no need to use separate processes
    await loadConatConfiguration();
    const id = "0";
    initPersistServer({
      id,
      clusterMode: true,
      service: PERSIST_SERVICE,
      maintenance: maintenance?.createLocalHooks(id),
    });
    initLoadBalancer({ ids: [id], client: conat(), service: PERSIST_SERVICE });
    return;
  }

  // more than 1 so no possible value to multiple servers if we don't
  // use separate processes
  createPersistCluster(maintenance);
}

async function createPersistCluster(
  maintenance?: PersistMaintenanceCoordinator,
) {
  logger.debug(
    "initPersistServer: creating cluster with",
    conatPersistCount,
    "processes",
  );
  const ids: string[] = [];
  for (let i = 0; i < conatPersistCount; i++) {
    const id = `${i}`;
    ids.push(id);
    logger.debug("initPersistServer: starting node ", { id });
    createForkedPersistServer(id, maintenance);
  }
  initLoadBalancer({ ids, client: conat(), service: PERSIST_SERVICE });
}
