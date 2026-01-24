class UserManager {
  constructor() {
    this.users = new Map(); // socketId -> userData
    this.waitingUsers = {
      '12-16': { male: [], female: [], other: [] },
      '18-26': { male: [], female: [], other: [] },
      '26-35': { male: [], female: [], other: [] },
      '35+': { male: [], female: [], other: [] }
    };
    this.activePairs = new Map(); // socketId -> partnerSocketId
    this.userRooms = new Map(); // socketId -> roomId
  }

  addUser(socketId, userData) {
    this.users.set(socketId, {
      ...userData,
      socketId,
      joinedAt: Date.now(),
      status: 'online'
    });
  }

  removeUser(socketId) {
    const user = this.users.get(socketId);
    if (user) {
      // Удаляем из очереди ожидания
      this.removeFromWaiting(socketId);
      
      // Разрываем пару если есть
      this.removePair(socketId);
    }
    this.users.delete(socketId);
  }

  addToWaiting(socketId, filters) {
    const user = this.users.get(socketId);
    if (!user) return;

    const ageGroup = this.getAgeGroup(user.age);
    const gender = user.gender;
    
    // Проверяем существование категории
    if (this.waitingUsers[ageGroup] && this.waitingUsers[ageGroup][gender]) {
      this.waitingUsers[ageGroup][gender].push({
        socketId,
        user,
        filters
      });
      user.status = 'waiting';
    }
  }

  removeFromWaiting(socketId) {
    for (const ageGroup in this.waitingUsers) {
      for (const gender in this.waitingUsers[ageGroup]) {
        const index = this.waitingUsers[ageGroup][gender]
          .findIndex(u => u.socketId === socketId);
        if (index > -1) {
          this.waitingUsers[ageGroup][gender].splice(index, 1);
          break;
        }
      }
    }
  }

  findMatch(socketId, filters) {
    const user = this.users.get(socketId);
    if (!user) return null;

    const userAgeGroup = this.getAgeGroup(user.age);
    
    // Ищем подходящего партнера
    for (const targetGender of this.getTargetGenders(filters.targetGender)) {
      const waitingList = this.waitingUsers[userAgeGroup][targetGender];
      
      for (let i = 0; i < waitingList.length; i++) {
        const candidate = waitingList[i];
        
        // Проверяем взаимную совместимость
        if (candidate.socketId !== socketId && 
            this.checkCompatibility(user, candidate.user, filters, candidate.filters)) {
          
          // Удаляем обоих из очереди ожидания
          this.removeFromWaiting(socketId);
          this.removeFromWaiting(candidate.socketId);
          
          return candidate;
        }
      }
    }
    
    return null;
  }

  createPair(user1Id, user2Id, roomId) {
    this.activePairs.set(user1Id, user2Id);
    this.activePairs.set(user2Id, user1Id);
    this.userRooms.set(user1Id, roomId);
    this.userRooms.set(user2Id, roomId);
    
    const user1 = this.users.get(user1Id);
    const user2 = this.users.get(user2Id);
    
    if (user1) user1.status = 'chatting';
    if (user2) user2.status = 'chatting';
    
    return {
      user1: this.getSafeUserData(user1),
      user2: this.getSafeUserData(user2)
    };
  }

  removePair(socketId) {
    const partnerId = this.activePairs.get(socketId);
    
    if (partnerId) {
      this.activePairs.delete(socketId);
      this.activePairs.delete(partnerId);
      this.userRooms.delete(socketId);
      this.userRooms.delete(partnerId);
      
      const user = this.users.get(socketId);
      const partner = this.users.get(partnerId);
      
      if (user) user.status = 'online';
      if (partner) partner.status = 'online';
      
      return partnerId;
    }
    
    return null;
  }

  getAgeGroup(age) {
    if (age >= 12 && age <= 16) return '12-16';
    if (age >= 18 && age <= 26) return '18-26';
    if (age >= 26 && age <= 35) return '26-35';
    return '35+';
  }

  getTargetGenders(target) {
    if (target === 'any') return ['male', 'female', 'other'];
    return [target];
  }

  checkCompatibility(user1, user2, filters1, filters2) {
    // Проверяем возрастные группы
    const ageGroup1 = this.getAgeGroup(user1.age);
    const ageGroup2 = this.getAgeGroup(user2.age);
    
    // Проверяем взаимные фильтры
    const genderMatch1 = filters1.targetGender === 'any' || 
                         filters1.targetGender === user2.gender;
    const genderMatch2 = filters2.targetGender === 'any' || 
                         filters2.targetGender === user1.gender;
    
    return genderMatch1 && genderMatch2 && ageGroup1 === ageGroup2;
  }

  getSafeUserData(user) {
    if (!user) return null;
    return {
      name: user.name,
      age: user.age,
      gender: user.gender,
      status: user.status
    };
  }

  getOnlineCount() {
    return this.users.size;
  }

  getChattingCount() {
    return this.activePairs.size / 2;
  }

  getUser(socketId) {
    return this.users.get(socketId);
  }

  getPartner(socketId) {
    return this.activePairs.get(socketId);
  }

  getRoom(socketId) {
    return this.userRooms.get(socketId);
  }
}

module.exports = new UserManager();
