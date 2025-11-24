// adminEvents.ts — MASTER EVENT LIST

export type AdminEventName =
  | "ping"
  | "admin:getInitialSnapshot"
  | "admin:addToArena"
  | "admin:addToQueue"
  | "admin:removeFromQueue"
  | "admin:promoteUser"
  | "admin:demoteUser"
  | "admin:eliminate"
  | "admin:startRound"
  | "admin:endRound"
  | "admin:startGame"
  | "admin:stopGame"
  | "admin:searchUsers"
  | "admin:updateSettings"
  | "admin:giveTwist"
  | "admin:useTwist"
  | "admin:getHosts"
  | "admin:createHost"
  | "admin:deleteHost"
  | "admin:setActiveHost";
