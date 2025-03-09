import {MavenAGIClient} from "mavenagi";

export const mavenagiClient = (organizationId: string, agentId: string) => {
  return new MavenAGIClient({
    organizationId,
    agentId,
  });
}

export const mavenagiSettings = async (organizationId: string, agentId: string) => {
  return (await mavenagiClient(organizationId, agentId).appSettings.get()) as unknown as AppSettings
}


