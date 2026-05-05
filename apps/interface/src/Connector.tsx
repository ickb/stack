import { useQuery } from "@tanstack/react-query";
import { ccc } from "@ckb-ccc/ccc";
import type { JSX } from "react/jsx-runtime";
import App from "./App.tsx";
import { EmptyDashboard } from "./Dashboard.tsx";
import Progress from "./Progress.tsx";
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
  const {
    isPending,
    error,
    data: walletConfig,
  } = useQuery({
    queryKey: [rootConfig.chain, "walletConfig"],
    queryFn: async () => {
      if (!(await signer.isConnected())) {
        await signer.connect();
      }

      const [recommendedAddressObj, addressObjs] = await Promise.all([
        signer.getRecommendedAddressObj(),
        signer.getAddressObjs(),
      ]);

      let accountLocks = [recommendedAddressObj, ...addressObjs].map(({ script }) =>
        ccc.Script.from(script),
      );

      // Keep unique account locks, preferred one is the first one.
      accountLocks = [
        ...new Map(accountLocks.map((script) => [script.toHex(), script])).values(),
      ];

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
