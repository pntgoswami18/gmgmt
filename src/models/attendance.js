// Model for attendance records

class Attendance {
    constructor(id, memberId, checkInTime, checkOutTime) {
        this.id = id;
        this.memberId = memberId;
        this.checkInTime = checkInTime;
        this.checkOutTime = checkOutTime;
    }

    // Methods to save and retrieve attendance from the database.
}

module.exports = Attendance;
