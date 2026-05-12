import { useQuery } from "@tanstack/react-query";
import { ccc } from "@ckb-ccc/ccc";
import { unique } from "@ickb/utils";
import { useEffect, useState } from "react";
import type { JSX } from "react/jsx-runtime";
import App from "./App.tsx";
import { EmptyDashboard } from "./Dashboard.tsx";
import Progress from "./Progress.tsx";
import {
  connectorWalletConfigQueryKey,
  objectIdentityKey,
} from "./connectorQueryKey.ts";
import { errorMessageOf, type RootConfig } from "./utils.ts";

export default function Connector({
  rootConfig,
  signer,
  walletName,
}: {
  rootConfig: RootConfig;
  signer: ccc.Signer;
  walletName: string;
}): JSX.Element {
  const signerKey = objectIdentityKey(signer);
  const [signerVersion, setSignerVersion] = useState(0);
  useEffect(
    () => signer.onReplaced(() => {
      setSignerVersion((version) => version + 1);
    }),
    [signer],
  );
  const {
    isPending,
    error,
    data: walletConfig,
  } = useQuery({
    queryKey: connectorWalletConfigQueryKey(
      rootConfig,
      walletName,
      signerKey,
      signerVersion,
    ),
    queryFn: async () => {
      if (!(await signer.isConnected())) {
        await signer.connect();
      }

      const [recommendedAddressObj, addressObjs] = await Promise.all([
        signer.getRecommendedAddressObj(),
        signer.getAddressObjs(),
      ]);

      const accountLocks = [...unique([recommendedAddressObj, ...addressObjs].map(({ script }) =>
        ccc.Script.from(script),
      ))];

      return {
        ...rootConfig,
        signer,
        address: recommendedAddressObj.toString(),
        accountLocks,
        primaryLock: accountLocks[0] ?? ccc.Script.from(recommendedAddressObj.script),
      };
    },
  });

  if (isPending) {
    return (
      <>
        <EmptyDashboard />
        <Progress>Waiting for {walletName} authorization...</Progress>
      </>
    );
  }

  if (error) {
    return <p>Unable to connect to {walletName}: {errorMessageOf(error)}</p>;
  }

  return <App {...{ walletConfig }} />;
}
