import cuid from 'cuid';

import {
  DatasourceStatus,
  DatasourceType,
  SubscriptionPlan,
} from '@chaindesk/prisma';
import { prisma } from '@chaindesk/prisma/client';

import accountConfig from '../account-config';
import generateFunId from '../generate-fun-id';
import { GoogleDriveManager } from '../google-drive-manager';
import triggerTaskLoadDatasource from '../trigger-task-load-datasource';
import { AppDocument } from '../types/document';
import { AcceptedDatasourceMimeTypes } from '../types/dtos';

import { DatasourceLoaderBase } from './base';

export class GoogleDriveFolderLoader extends DatasourceLoaderBase {
  isGroup = true;

  async getSize(text: string) {
    // return new Blob([text]).size;
    return 0;
  }

  async load() {
    const driveManager = new GoogleDriveManager({
      accessToken: this.datasource?.serviceProvider?.accessToken!,
      refreshToken: this.datasource?.serviceProvider?.refreshToken!,
    });

    const currentPlan =
      this.datasource?.organization?.subscriptions?.[0]?.plan ||
      SubscriptionPlan.level_0;

    await driveManager.refreshAuth();

    const files = (
      await driveManager.listFilesRecursive({
        folderId: (this.datasource as any)?.config?.objectId as string,
      })
    )?.filter(
      (each) =>
        Number(each.size || 0) < accountConfig[currentPlan]?.limits?.maxFileSize
    );

    const children = await prisma.appDatasource.findMany({
      where: {
        groupId: this.datasource?.id,
      },
      select: {
        id: true,
        config: true,
      },
    });

    const ids = files.map((f) => {
      const found = children.find(
        (each) => (each as any)?.config?.objectId === f.id
      );

      if (found) {
        return found.id;
      }

      return cuid();
    });

    await prisma.appDatasource.createMany({
      data: files.map((each, idx) => ({
        id: ids[idx],
        type: DatasourceType.google_drive_file,
        name: each?.name!,
        config: {
          objectId: each?.id,
        },
        organizationId: this.datasource?.organizationId,
        datastoreId: this.datasource?.datastoreId,
        groupId: this.datasource?.id,
        serviceProviderId: this.datasource?.serviceProviderId,
      })),
      skipDuplicates: true,
    });

    await triggerTaskLoadDatasource(
      [...ids].map((id) => ({
        organizationId: this.datasource?.organizationId!,
        datasourceId: id,
        priority: 10,
      }))
    );

    await prisma.appDatasource.update({
      where: {
        id: this.datasource.id,
      },
      data: {
        status: DatasourceStatus.synched,
      },
    });

    return [] as AppDocument[];
  }
}
